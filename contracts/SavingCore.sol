// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "./VaultManager.sol";

/**
 * @title SavingCore
 * @notice "Phòng giao dịch" chính của hệ thống - toàn bộ nghiệp vụ Term Deposit nằm ở đây:
 *         quản lý Plan, mở deposit, rút tiền, gia hạn, và mint NFT chứng chỉ cho mỗi deposit.
 * @dev PHẠM VI NGÀY 3: struct + khung contract (ERC721, AccessControl, Pausable, ReentrancyGuard)
 *      + toàn bộ nhóm hàm quản lý Plan (createPlan/updatePlan/enable/disablePlan).
 *      CHƯA làm: openDeposit, withdrawAtMaturity, earlyWithdraw, renewDeposit, autoRenewDeposit
 *      -> những hàm này thuộc phạm vi Ngày 4 và Ngày 5, sẽ nối tiếp vào file này.
 */
contract SavingCore is ERC721, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");

    // ==================== STATE: TOKEN & VAULT ====================

    // Token dùng làm tiền gốc (principal) - chính là MockUSDC.
    IERC20 public immutable depositToken;

    // Contract giữ tiền lãi - tách biệt hoàn toàn khỏi principal (Business Rule #5).
    VaultManager public immutable vault;

    // Địa chỉ nhận tiền phạt khi user rút sớm.
    address public feeReceiver;

    // Khoảng thời gian "ân hạn" (tính bằng giây) sau khi đáo hạn mà deposit vẫn chưa bị
    // auto-renew. Trong khoảng này user có thể tự renewDeposit hoặc withdrawAtMaturity.
    // Chỉ sau khi vượt quá (maturityAt + gracePeriodSeconds) thì bot mới được phép
    // gọi autoRenewDeposit - ngăn bot chạy tranh trước khi user kịp phản ứng.
    uint256 public gracePeriodSeconds;

    // ==================== STATE: PLAN ====================

    /**
     * @dev struct Plan = "tờ rơi quảng cáo" 1 gói tiết kiệm do admin tạo ra (Mục 2.1 đề bài).
     *      Dùng uint16 cho các trường nhỏ (tenor tính bằng ngày, APR/penalty tính bằng bps)
     *      để tiết kiệm gas storage (Solidity gộp nhiều biến nhỏ vào chung 1 "storage slot"
     *      nếu tổng kích thước <= 32 byte - đây gọi là "storage packing", không bắt buộc
     *      phải tối ưu ở mức bài tập, nhưng là thói quen tốt).
     */
    struct Plan {
        uint16 tenorDays;
        uint16 aprBps;
        uint16 earlyWithdrawPenaltyBps;
        uint256 minDeposit;
        uint256 maxDeposit; // 0 = không giới hạn tối đa
        bool enabled;
    }

    mapping(uint256 => Plan) public plans;
    uint256 private _nextPlanId; // bộ đếm tự tăng cho planId, bắt đầu từ 0

    // ==================== STATE: DEPOSIT ====================

    /**
     * @dev Trạng thái vòng đời của 1 deposit - khớp với 4 trạng thái mô tả ở Mục 2.2 đề bài.
     */
    enum Status {
        Active,
        Withdrawn,
        ManualRenewed,
        AutoRenewed
    }

    /**
     * @dev struct Deposit = "biên lai" ghi lại 1 lần user gửi tiền (Mục 2.2 đề bài).
     *      QUAN TRỌNG NHẤT: aprBpsAtOpen và penaltyBpsAtOpen là 2 trường SNAPSHOT -
     *      chúng COPY giá trị từ Plan tại thời điểm mở deposit, không phải tham chiếu
     *      ngược lại Plan. Nhờ vậy, dù sau này admin gọi updatePlan() đổi aprBps của Plan,
     *      các deposit ĐÃ MỞ trước đó vẫn giữ nguyên con số cũ - đây chính là cách hiện thực
     *      Business Rule #1 (Mục 6: "APR và penalty snapshot, không đổi theo plan sau này").
     *      depositId TRÙNG với tokenId của NFT - không cần mapping riêng để tra owner,
     *      tận dụng luôn ownerOf() có sẵn từ ERC721.
     */
    struct Deposit {
        uint256 planId;
        uint256 principal;
        uint256 maturityAt;
        uint16 aprBpsAtOpen;
        uint16 penaltyBpsAtOpen;
        Status status;
    }

    mapping(uint256 => Deposit) public deposits;
    uint256 private _nextDepositId; // bộ đếm tự tăng cho depositId (= tokenId NFT)

    // ==================== EVENTS (bắt buộc theo Mục 5 đề bài) ====================

    event PlanCreated(uint256 indexed planId, uint16 tenorDays, uint16 aprBps);
    event PlanUpdated(uint256 indexed planId, uint16 newAprBps);
    event DepositOpened(
        uint256 indexed depositId,
        address indexed owner,
        uint256 indexed planId,
        uint256 principal,
        uint256 maturityAt,
        uint16 aprBpsAtOpen
    );
    event Withdrawn(uint256 indexed depositId, address indexed owner, uint256 principal, uint256 interest, bool isEarly);
    event Renewed(uint256 indexed oldDepositId, uint256 indexed newDepositId, uint256 newPrincipal, uint256 indexed newPlanId);

    /**
     * @param _depositToken Địa chỉ MockUSDC dùng làm tiền gốc
     * @param _vault Địa chỉ VaultManager đã deploy trước đó
     * @param _feeReceiver Địa chỉ nhận phạt rút sớm ban đầu
     * @param _gracePeriodSeconds Thời gian ân hạn (giây) sau đáo hạn trước khi bot được auto-renew
     */
    constructor(
        address _depositToken,
        address _vault,
        address _feeReceiver,
        uint256 _gracePeriodSeconds
    )
        ERC721("Term Deposit Certificate", "TDC")
    {
        require(_depositToken != address(0), "token address is zero");
        require(_vault != address(0), "vault address is zero");
        require(_feeReceiver != address(0), "fee receiver is zero");
        require(_gracePeriodSeconds > 0, "grace period must be > 0");

        depositToken = IERC20(_depositToken);
        vault = VaultManager(_vault);
        feeReceiver = _feeReceiver;
        gracePeriodSeconds = _gracePeriodSeconds;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(ADMIN_ROLE, msg.sender);
    }

    // ==================== ADMIN: PLAN MANAGEMENT ====================
    // Phạm vi chính của Ngày 3. Đây là các hàm cho phép "Bank Admin" (Mục 1 đề bài)
    // thiết lập những gói tiết kiệm mà user sẽ chọn để mở deposit.

    /**
     * @notice Tạo 1 gói tiết kiệm mới.
     * @dev Chỉ ADMIN_ROLE gọi được. planId tự tăng dần từ 0, không cho admin tự chọn số
     *      (tránh trùng lặp hoặc ghi đè nhầm plan cũ).
     *      Validate cơ bản: aprBps và penaltyBps phải hợp lý (< 10000 bps = dưới 100%,
     *      tránh admin lỡ tay nhập sai đơn vị, ví dụ nhập "400" tưởng là 4% nhưng thực ra
     *      cần nhập đúng bps).
     */
    function createPlan(
        uint16 tenorDays,
        uint16 aprBps,
        uint16 earlyWithdrawPenaltyBps,
        uint256 minDeposit,
        uint256 maxDeposit
    ) external onlyRole(ADMIN_ROLE) returns (uint256 planId) {
        require(tenorDays > 0, "tenor must be > 0");
        require(aprBps > 0 && aprBps < 10000, "apr out of range");
        require(earlyWithdrawPenaltyBps < 10000, "penalty out of range");
        require(maxDeposit == 0 || maxDeposit >= minDeposit, "maxDeposit < minDeposit");

        planId = _nextPlanId++;
        plans[planId] = Plan({
            tenorDays: tenorDays,
            aprBps: aprBps,
            earlyWithdrawPenaltyBps: earlyWithdrawPenaltyBps,
            minDeposit: minDeposit,
            maxDeposit: maxDeposit,
            enabled: true // plan mới tạo mặc định bật luôn, admin có thể disable sau nếu cần
        });

        emit PlanCreated(planId, tenorDays, aprBps);
    }

    /**
     * @notice Đổi APR của 1 plan đã tồn tại.
     * @dev CHỈ ảnh hưởng đến các deposit MỞ MỚI sau thời điểm này. Các deposit đã mở trước đó
     *      không hề bị ảnh hưởng, vì chúng đọc aprBpsAtOpen (đã snapshot) chứ không đọc
     *      plans[planId].aprBps trực tiếp mỗi lần tính lãi. Đây chính là điểm mà câu hỏi mở
     *      thường xoáy vào để kiểm tra bạn có thực sự hiểu snapshot hay không.
     */
    function updatePlan(uint256 planId, uint16 newAprBps) external onlyRole(ADMIN_ROLE) {
        require(planId < _nextPlanId, "plan does not exist");
        require(newAprBps > 0 && newAprBps < 10000, "apr out of range");

        plans[planId].aprBps = newAprBps;
        emit PlanUpdated(planId, newAprBps);
    }

    /**
     * @notice Bật plan - cho phép mở deposit mới theo plan này.
     */
    function enablePlan(uint256 planId) external onlyRole(ADMIN_ROLE) {
        require(planId < _nextPlanId, "plan does not exist");
        plans[planId].enabled = true;
    }

    /**
     * @notice Tắt plan - KHÔNG cho mở deposit mới, nhưng KHÔNG ảnh hưởng deposit đang active
     *         theo plan này (chúng vẫn tiếp tục chạy đến khi đáo hạn bình thường).
     * @dev Đây liên quan trực tiếp đến câu hỏi mở #6 (Disabled plan với deposit đang active) -
     *      cần quyết định rõ: user có được RENEW vào 1 plan đã bị disable hay không?
     *      (Sẽ trả lời chi tiết ở Ngày 7 khi viết renewDeposit.)
     */
    function disablePlan(uint256 planId) external onlyRole(ADMIN_ROLE) {
        require(planId < _nextPlanId, "plan does not exist");
        plans[planId].enabled = false;
    }

    /**
     * @notice Đổi địa chỉ nhận phí phạt rút sớm.
     */
    function setFeeReceiver(address receiver) external onlyRole(ADMIN_ROLE) {
        require(receiver != address(0), "fee receiver is zero");
        feeReceiver = receiver;
    }

    /**
     * @notice Cập nhật thời gian ân hạn sau khi deposit đáo hạn.
     * @dev Chỉ ADMIN_ROLE mới được gọi. Thời gian > 0 là bắt buộc - nếu = 0 thì bot có thể
     *      gọi autoRenewDeposit ngay tức thì sau maturityAt, không cho user thời gian phản ứng.
     * @param newGracePeriodSeconds Giá trị mới tính bằng giây.
     */
    function setGracePeriod(uint256 newGracePeriodSeconds) external onlyRole(ADMIN_ROLE) {
        require(newGracePeriodSeconds > 0, "grace period must be > 0");
        gracePeriodSeconds = newGracePeriodSeconds;
    }

    function pause() external onlyRole(ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(ADMIN_ROLE) {
        _unpause();
    }

    // ==================== VIEW HELPERS ====================

    function getPlan(uint256 planId) external view returns (Plan memory) {
        require(planId < _nextPlanId, "plan does not exist");
        return plans[planId];
    }

    function getDeposit(uint256 depositId) external view returns (Deposit memory) {
        require(depositId < _nextDepositId, "deposit does not exist");
        return deposits[depositId];
    }

    // ==================== BẮT BUỘC KHI KẾ THỪA NHIỀU CONTRACT ====================

    /**
     * @dev ERC721 và AccessControl đều định nghĩa hàm supportsInterface() (chuẩn ERC165
     *      để "khai báo" contract này tuân thủ những interface nào). Vì SavingCore kế thừa
     *      CẢ HAI, Solidity bắt buộc phải override lại và tự merge kết quả 2 bên - nếu không
     *      code sẽ không compile được. Đây không phải logic nghiệp vụ, chỉ là yêu cầu kỹ
     *      thuật của Solidity khi kế thừa nhiều (multiple inheritance).
     */
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ==================== NGÀY 4-5: DEPOSIT CORE LOGIC ====================
    // Phạm vi Ngày 4: openDeposit, calculateInterest, calculatePenalty,
    //                 withdrawAtMaturity, earlyWithdraw.
    // Phạm vi Ngày 5 (chưa làm): renewDeposit, autoRenewDeposit.

    /**
     * @notice Mở 1 khoản tiết kiệm mới theo gói Plan đã chọn.
     * @dev whenNotPaused: ngăn mở deposit khi contract đang bị tạm dừng khẩn cấp.
     *      Luồng xử lý theo đúng thứ tự "check - effects - interactions" (CEI pattern):
     *        1. CHECK: kiểm tra đầu vào hợp lệ.
     *        2. EFFECTS: ghi state (deposits, mint NFT) trước.
     *        3. INTERACTIONS: chuyển token (external call) sau cùng.
     *      Thứ tự này giúp phòng tránh reentrancy attack (dù đã có ReentrancyGuard, CEI
     *      là lớp bảo vệ thứ 2 - defence in depth).
     * @param planId   ID của gói tiết kiệm user chọn.
     * @param amount   Số token muốn gửi (tính bằng đơn vị nhỏ nhất của depositToken).
     * @return depositId  ID của khoản deposit vừa mở (cũng là tokenId của NFT chứng chỉ).
     */
    function openDeposit(uint256 planId, uint256 amount)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 depositId)
    {
        Plan storage plan = plans[planId];

        // CHECK 1: Gói phải đang được phép mở (admin có thể tạm disable một gói bất kỳ lúc nào).
        require(plan.enabled, "plan is not enabled");

        // CHECK 2: Số tiền gửi phải đạt mức tối thiểu của gói.
        require(amount >= plan.minDeposit, "amount below minDeposit");

        // CHECK 3: Nếu plan có giới hạn tối đa (maxDeposit > 0), kiểm tra không được vượt.
        //          maxDeposit == 0 có nghĩa là "không giới hạn" - đây là convention trong hệ thống.
        require(plan.maxDeposit == 0 || amount <= plan.maxDeposit, "amount above maxDeposit");

        // EFFECTS: gán depositId trước khi làm bất cứ điều gì khác.
        //          _nextDepositId++ trả về giá trị TRƯỚC khi tăng (post-increment trong Solidity),
        //          tương đương: depositId = _nextDepositId; _nextDepositId += 1;
        depositId = _nextDepositId++;

        // SNAPSHOT: Copy giá trị aprBps và penaltyBps từ Plan vào Deposit ngay tại thời điểm mở.
        //           ĐÂY LÀ ĐIỂM CỐT LÕI của Business Rule #1:
        //           - Sau này dù admin gọi updatePlan() thay đổi aprBps của Plan,
        //             deposit này vẫn đọc aprBpsAtOpen (con số cũ đã được lưu riêng), không bao giờ
        //             đọc lại plans[planId].aprBps nữa.
        //           - Tránh dùng "storage pointer" ở đây vì nếu admin đổi Plan, pointer sẽ bị
        //             ảnh hưởng theo. Phải COPY từng trường ra.
        deposits[depositId] = Deposit({
            planId: planId,
            principal: amount,
            maturityAt: block.timestamp + (uint256(plan.tenorDays) * 1 days),
            aprBpsAtOpen: plan.aprBps,           // SNAPSHOT - không phải tham chiếu đến plan
            penaltyBpsAtOpen: plan.earlyWithdrawPenaltyBps, // SNAPSHOT
            status: Status.Active
        });

        // INTERACTIONS (1/2): Chuyển token từ user vào contract NÀY TRƯỚC.
        //   - Lý do đổi thứ tự so với CEI thuần túy: _safeMint() bên dưới sẽ gọi
        //     onERC721Received() nếu msg.sender là smart contract - đây là external call
        //     có thể bị kẻ tấn công dùng để callback vào earlyWithdraw() hoặc hàm khác.
        //   - Bằng cách chuyển token VÀO TRƯỚC, ta đảm bảo tiền đã thực sự trong contract
        //     trước khi bất kỳ callback nào có thể chạy - xóa bỏ vector tấn công reentrancy.
        //   - nonReentrant modifier ở chữ ký hàm là lớp phòng thủ thứ 2 (defence in depth).
        //   - safeTransferFrom tự revert nếu user chưa approve hoặc không đủ số dư.
        depositToken.safeTransferFrom(msg.sender, address(this), amount);

        // INTERACTIONS (2/2): Mint NFT chứng chỉ cho user SAU KHI tiền đã vào contract.
        //   - tokenId == depositId để tra cứu owner bằng ownerOf() mà không cần mapping riêng.
        //   - _safeMint an toàn hơn _mint: kiểm tra IERC721Receiver nếu recipient là contract.
        _safeMint(msg.sender, depositId);

        emit DepositOpened(depositId, msg.sender, planId, amount, deposits[depositId].maturityAt, plan.aprBps);
    }

    /**
     * @notice Tính lãi dự kiến nhận được khi đáo hạn cho 1 khoản deposit.
     * @dev Công thức lãi đơn (simple interest):
     *        interest = principal * aprBps * tenorSeconds / (365 days * 10000)
     *      QUAN TRỌNG - thứ tự nhân/chia:
     *        - Nhân HẾT trước (principal * aprBps * tenorSeconds), sau đó mới chia.
     *        - Tuyệt đối KHÔNG viết: (principal / (365 days * 10000)) * aprBps * tenorSeconds
     *          vì nếu principal nhỏ, phép chia đầu tiên sẽ làm tròn xuống 0, mất toàn bộ lãi.
     *        - Solidity không có số thập phân, nên nhân trước - chia sau là cách duy nhất
     *          giữ độ chính xác tối đa trước khi làm tròn.
     *      aprBpsAtOpen: đọc từ snapshot của deposit, KHÔNG đọc plans[planId].aprBps hiện tại,
     *      đảm bảo deposit đã mở không bị ảnh hưởng khi admin thay đổi Plan sau này.
     * @param depositId  ID của khoản deposit cần tính lãi.
     * @return           Số lãi (cùng đơn vị với principal / depositToken).
     */
    function calculateInterest(uint256 depositId) public view returns (uint256) {
        Deposit storage dep = deposits[depositId];

        // tenorSeconds: tính từ dữ liệu của Plan hiện tại (chỉ đọc tenorDays, không đọc aprBps).
        // Cách tiếp cận này hợp lệ vì tenorDays của Plan không bao giờ thay đổi sau khi tạo
        // (không có hàm updatePlan cho tenorDays). Nếu sau này có, cần snapshot cả tenorDays.
        uint256 tenorSeconds = uint256(plans[dep.planId].tenorDays) * 1 days;

        // Nhân tất cả trước (principal * aprBpsAtOpen * tenorSeconds), chia sau.
        // aprBpsAtOpen là uint16 - phải ép kiểu về uint256 trước khi nhân tránh overflow (unlikely
        // ở uint16 nhưng là thói quen an toàn khi làm việc với Solidity arithmetic).
        return (dep.principal * uint256(dep.aprBpsAtOpen) * tenorSeconds) / (365 days * 10000);
    }

    /**
     * @notice Tính số tiền phạt nếu user rút sớm trước khi đáo hạn.
     * @dev Công thức: penalty = principal * penaltyBpsAtOpen / 10000
     *      penaltyBpsAtOpen là snapshot - giá trị đã được chốt lúc mở deposit.
     *      Dù admin gọi updatePlan() để đổi earlyWithdrawPenaltyBps của Plan, khoản deposit
     *      này vẫn tính phạt theo mức đã snapshot, đảm bảo tính minh bạch và công bằng
     *      với user (user ký kết theo điều khoản nào, phạt theo điều khoản đó).
     * @param depositId  ID của khoản deposit cần tính phạt.
     * @return           Số tiền bị trừ phạt khi rút sớm.
     */
    function calculatePenalty(uint256 depositId) public view returns (uint256) {
        Deposit storage dep = deposits[depositId];
        // Nhân trước chia sau - tương tự calculateInterest để nhất quán và tránh mất độ chính xác.
        return (dep.principal * uint256(dep.penaltyBpsAtOpen)) / 10000;
    }

    /**
     * @notice Rút tiền khi đáo hạn: nhận lại toàn bộ principal + lãi.
     * @dev nonReentrant: chặn reentrancy attack (dù đã dùng CEI pattern ở trên,
     *      nonReentrant là lớp bảo vệ bắt buộc cho mọi hàm có external call chuyển tiền).
     *      whenNotPaused: ngăn rút tiền khi contract đang xử lý sự cố khẩn cấp.
     *      Lãi (interest) được lấy từ VaultManager (vault.payInterest) - không phải từ số dư
     *      principal trong contract này - đúng với Business Rule #5: tách biệt principal và lãi.
     * @param depositId  ID của khoản deposit muốn rút.
     */
    function withdrawAtMaturity(uint256 depositId)
        external
        nonReentrant
        whenNotPaused
    {
        // CHECK: Chỉ chủ sở hữu NFT mới được rút (ownerOf từ ERC721 sẽ revert nếu token không tồn tại).
        require(ownerOf(depositId) == msg.sender, "not owner");

        // CHECK: Chỉ deposit đang Active mới được rút (tránh rút 2 lần).
        require(deposits[depositId].status == Status.Active, "not active");

        // CHECK: Phải đợi đến sau hoặc đúng thời điểm đáo hạn.
        require(block.timestamp >= deposits[depositId].maturityAt, "not matured yet");

        // Đọc dữ liệu cần thiết vào bộ nhớ trước khi thay đổi state (thói quen tốt với CEI).
        uint256 principal = deposits[depositId].principal;
        uint256 interest = calculateInterest(depositId);

        // EFFECTS: Đổi status TRƯỚC khi chuyển tiền - phòng reentrancy (lớp CEI).
        deposits[depositId].status = Status.Withdrawn;

        // INTERACTIONS: Trả principal (từ số dư token trong contract này).
        depositToken.safeTransfer(msg.sender, principal);

        // INTERACTIONS: Gọi vault để trả lãi (vault giữ pool lãi riêng, tách biệt với principal).
        //               vault.payInterest sẽ chuyển interest token từ VaultManager sang msg.sender.
        vault.payInterest(msg.sender, interest);

        // isEarly = false: đây là rút đúng hạn, không phạt.
        emit Withdrawn(depositId, msg.sender, principal, interest, false);
    }

    /**
     * @notice Rút tiền sớm trước khi đáo hạn: mất toàn bộ lãi, bị trừ thêm tiền phạt.
     * @dev Lý do KHÔNG trả lãi khi rút sớm (interest = 0):
     *      - Business Rule bắt buộc theo đề bài: rút sớm đồng nghĩa từ bỏ quyền hưởng lãi.
     *      - Về mặt tài chính: ngân hàng chưa "chốt sổ" lãi cho deposit chưa đáo hạn,
     *        việc trả lãi lũy kế đến thời điểm rút sớm sẽ phức tạp hóa mô hình không cần thiết.
     *      Tiền phạt (penalty) được chuyển thẳng cho feeReceiver (ví của tổ chức/dự án),
     *      không giữ lại trong contract - tránh tích lũy ETH/token không kiểm soát.
     * @param depositId  ID của khoản deposit muốn rút sớm.
     */
    function earlyWithdraw(uint256 depositId)
        external
        nonReentrant
        whenNotPaused
    {
        // CHECK: Chỉ chủ sở hữu NFT mới được rút.
        require(ownerOf(depositId) == msg.sender, "not owner");

        // CHECK: Chỉ deposit đang Active.
        require(deposits[depositId].status == Status.Active, "not active");

        // CHECK: Phải chưa đáo hạn - nếu đã đáo hạn thì dùng withdrawAtMaturity để nhận lãi.
        require(
            block.timestamp < deposits[depositId].maturityAt,
            "already matured, use withdrawAtMaturity"
        );

        uint256 principal = deposits[depositId].principal;

        // penalty dùng snapshot penaltyBpsAtOpen - không đọc lại plan hiện tại.
        uint256 penalty = calculatePenalty(depositId);

        // Số tiền user thực nhận = principal - penalty.
        // Solidity 0.8+ tự revert nếu underflow (penalty > principal), nhưng thực tế
        // penaltyBpsAtOpen < 10000 (đã validate trong createPlan) nên penalty < principal luôn đúng.
        uint256 payout = principal - penalty;

        // EFFECTS: Đổi status trước khi chuyển tiền (CEI pattern).
        deposits[depositId].status = Status.Withdrawn;

        // INTERACTIONS: Trả phần còn lại sau phạt cho user.
        depositToken.safeTransfer(msg.sender, payout);

        // INTERACTIONS: Chuyển tiền phạt cho feeReceiver (không giữ lại trong contract).
        if (penalty > 0) {
            depositToken.safeTransfer(feeReceiver, penalty);
        }

        // interest = 0 (Business Rule: rút sớm không được hưởng lãi).
        // isEarly = true để front-end/event listener phân biệt loại rút tiền.
        emit Withdrawn(depositId, msg.sender, payout, 0, true);
    }

    // ==================== NGÀY 5: RENEW LOGIC ====================

    /**
     * @notice Gia hạn thủ công (Manual Renew): chủ sở hữu NFT tự chọn gói plan mới,
     *         gộp lãi vào vốn, mở khoản tiết kiệm mới ngay sau khi đáo hạn.
     * @dev Chỉ OWNER của depositId được gọi - đây là renew chủ động, user tự quyết định.
     *      Luồng CEI:
     *        1. CHECK:   ownerOf, status Active, đã đáo hạn, plan mới enabled, principal hợp lệ.
     *        2. EFFECTS: đổi status deposit cũ, ghi deposit mới.
     *        3. INTERACTIONS: vault.payInterest → _safeMint (đặt cuối cùng vì _safeMint
     *           có thể gọi onERC721Received() trên smart contract, tạo vector reentrancy;
     *           state phải hoàn toàn ổn định TRƯỚC khi mint - học từ bài học openDeposit).
     * @param depositId  ID của khoản deposit cũ cần gia hạn.
     * @param newPlanId  ID của gói tiết kiệm mới user muốn chuyển sang.
     * @return newDepositId  ID của khoản deposit mới vừa tạo.
     */
    function renewDeposit(uint256 depositId, uint256 newPlanId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 newDepositId)
    {
        // CHECK 1: Chỉ chủ sở hữu NFT mới được renew thủ công.
        require(ownerOf(depositId) == msg.sender, "not owner");

        // CHECK 2: Deposit phải đang ở trạng thái Active.
        require(deposits[depositId].status == Status.Active, "not active");

        // CHECK 3: Phải đã qua (hoặc đúng) thời điểm đáo hạn - renew trước hạn không hợp lệ.
        require(block.timestamp >= deposits[depositId].maturityAt, "not matured yet");

        // Đọc plan MỚI mà user muốn chuyển sang.
        Plan storage newPlan = plans[newPlanId];

        // CHECK 4: Plan mới BẮT BUỘC phải enabled.
        //          Lý do: renewDeposit là hành động CHỦ ĐỘNG - user tự chọn plan mới, đây là
        //          cam kết mới giữa user và hệ thống. Admin disable plan = tuyên bố "gói này
        //          không nhận khách mới". Do đó, dù là renew hay mở mới, cũng phải check enabled.
        //          (Khác với autoRenewDeposit - xem giải thích tại hàm đó.)
        require(newPlan.enabled, "new plan is not enabled");

        // Tính lãi từ deposit cũ (dùng lại calculateInterest - đọc aprBpsAtOpen snapshot, không
        // đọc plans[...].aprBps hiện tại, đảm bảo Business Rule #1).
        uint256 interest = calculateInterest(depositId);

        // newPrincipal = vốn cũ + lãi gộp vào (compound into new deposit).
        uint256 newPrincipal = deposits[depositId].principal + interest;

        // CHECK 5: newPrincipal phải nằm trong khoảng [minDeposit, maxDeposit] của plan mới.
        //          Tương tự check trong openDeposit - đảm bảo deposit mới tuân thủ giới hạn
        //          của gói plan mà user đã chọn.
        require(newPrincipal >= newPlan.minDeposit, "newPrincipal below minDeposit");
        require(
            newPlan.maxDeposit == 0 || newPrincipal <= newPlan.maxDeposit,
            "newPrincipal above maxDeposit"
        );

        // EFFECTS (1/3): Đánh dấu deposit CŨ là ManualRenewed - bắt buộc làm TRƯỚC interactions.
        //                Ngăn reentrancy đọc lại deposit cũ ở trạng thái Active.
        deposits[depositId].status = Status.ManualRenewed;

        // INTERACTIONS (1/3): Rút phần lãi từ VaultManager về CONTRACT NÀY (không phải user).
        //   Lý do: newPrincipal (vốn mới) = vốn cũ + lãi. Vốn cũ đã nằm sẵn trong contract.
        //   Nhưng phần lãi đang nằm trong VaultManager. Cần kéo phần lãi về SavingCore để
        //   contract này "backing" đủ newPrincipal cho deposit mới - không thiếu hụt tài sản.
        vault.payInterest(address(this), interest);

        // EFFECTS (2/3): Cấp phát depositId mới.
        newDepositId = _nextDepositId++;

        // EFFECTS (3/3): Ghi thông tin deposit mới với SNAPSHOT theo plan MỚI.
        //   aprBpsAtOpen = newPlan.aprBps: đây là cam kết MỚI - user đã chủ động chọn plan mới,
        //   nên APR cam kết theo plan mới tại thời điểm renew, không giữ APR cũ.
        //   (Khác hoàn toàn với autoRenewDeposit - xem giải thích tại hàm đó.)
        deposits[newDepositId] = Deposit({
            planId: newPlanId,
            principal: newPrincipal,
            maturityAt: block.timestamp + uint256(newPlan.tenorDays) * 1 days,
            aprBpsAtOpen: newPlan.aprBps,                       // SNAPSHOT theo plan MỚI
            penaltyBpsAtOpen: newPlan.earlyWithdrawPenaltyBps, // SNAPSHOT theo plan MỚI
            status: Status.Active
        });

        // INTERACTIONS (2/3): Mint NFT chứng chỉ mới cho user - ĐẶT CUỐI CÙNG.
        //   _safeMint có thể gọi onERC721Received() nếu msg.sender là smart contract,
        //   tạo cơ hội reentrancy. Mọi effects và interactions khác phải xong trước khi mint.
        _safeMint(msg.sender, newDepositId);

        emit Renewed(depositId, newDepositId, newPrincipal, newPlanId);
    }

    /**
     * @notice Gia hạn tự động (Auto Renew): BẤT KỲ AI cũng có thể gọi để gia hạn hộ user
     *         sau khi hết thời gian ân hạn (gracePeriodSeconds), giữ nguyên plan cũ.
     * @dev THIẾT KẾ CÓ CHỦ ĐÍCH - không check ownerOf(depositId) == msg.sender:
     *      Mục đích là cho phép bot (hoặc bất kỳ địa chỉ nào) tự động kích hoạt renew
     *      khi user quên không xử lý deposit đã đáo hạn. Đây là quyết định thiết kế từ
     *      Ngày 1, không phải thiếu sót bảo mật - user đã "đồng ý" điều này khi chọn plan
     *      có tính năng auto-renew.
     *
     *      THIẾT KẾ CÓ CHỦ ĐÍCH - không check plans[planId].enabled:
     *      Auto-renew là tiếp tục THỤ ĐỘNG plan cũ - không phải cam kết mới do user chọn.
     *      Admin disable plan = "không nhận khách MỞ MỚI", không có nghĩa là hủy bỏ
     *      các deposit đang chạy. Nếu check enabled thì bot sẽ không thể renew các deposit
     *      của plan đã bị disable, để lại deposit "mắc kẹt" - trải nghiệm xấu cho user.
     *      (Khớp với comment trong disablePlan(): không ảnh hưởng deposit đang active.)
     *
     *      Luồng CEI tương tự renewDeposit, với điểm khác biệt quan trọng:
     *      - Lưu owner TRƯỚC khi đổi status vì msg.sender KHÔNG PHẢI owner.
     *      - Mint NFT mới cho owner đã lưu, không phải msg.sender.
     * @param depositId  ID của khoản deposit cần được auto-renew.
     * @return newDepositId  ID của khoản deposit mới vừa tạo.
     */
    function autoRenewDeposit(uint256 depositId)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 newDepositId)
    {
        // CHECK 1: Deposit phải đang Active.
        require(deposits[depositId].status == Status.Active, "not active");

        // CHECK 2: Phải đã qua (maturityAt + gracePeriodSeconds).
        //          gracePeriodSeconds tạo "khoảng đệm" sau đáo hạn để user tự xử lý trước;
        //          bot chỉ được phép can thiệp SAU khi khoảng đệm này đã hết.
        require(
            block.timestamp >= deposits[depositId].maturityAt + gracePeriodSeconds,
            "grace period not passed yet"
        );

        // KHÔNG check plans[planId].enabled - xem giải thích chi tiết trong @dev của hàm.

        // Lưu owner TRƯỚC khi đổi status.
        //   Lý do: msg.sender trong hàm này là bot/bên thứ ba, KHÔNG PHẢI chủ sở hữu NFT.
        //   Sau khi đổi status (EFFECTS bên dưới), ownerOf vẫn trả đúng vì NFT chưa burn,
        //   nhưng đọc trước để code rõ ràng về intent và an toàn trong mọi tình huống.
        address owner = ownerOf(depositId);

        // Tính lãi từ deposit cũ (đọc aprBpsAtOpen snapshot - đúng Business Rule #1).
        uint256 interest = calculateInterest(depositId);

        // newPrincipal = vốn cũ + lãi gộp vào.
        uint256 newPrincipal = deposits[depositId].principal + interest;

        // EFFECTS (1/3): Đánh dấu deposit CŨ là AutoRenewed trước mọi interactions.
        deposits[depositId].status = Status.AutoRenewed;

        // INTERACTIONS (1/3): Kéo lãi từ VaultManager về SavingCore - giống renewDeposit,
        //   để contract này backing đủ newPrincipal cho deposit mới.
        vault.payInterest(address(this), interest);

        // EFFECTS (2/3): Cấp phát depositId mới.
        newDepositId = _nextDepositId++;

        // EFFECTS (3/3): Ghi thông tin deposit mới - GIỮ NGUYÊN plan cũ và APR gốc.
        //
        //   [BUSINESS RULE #4 - QUAN TRỌNG NHẤT CỦA HÀM NÀY]
        //   aprBpsAtOpen = deposits[depositId].aprBpsAtOpen  (KHÔNG phải plans[...].aprBps)
        //
        //   Lý do: Auto-renew là tiếp tục thụ động cùng 1 cam kết ban đầu của user với hệ thống.
        //   User đã được hứa hẹn mức APR khi mở deposit lần đầu. Nếu đọc plans[...].aprBps
        //   hiện tại, admin có thể lách luật: hạ APR của plan xuống thấp, sau đó để bot
        //   auto-renew để user bị "khóa" ở mức APR thấp mà không hề hay biết.
        //   Giữ nguyên aprBpsAtOpen = bảo vệ user theo đúng điều khoản họ đã ký ban đầu.
        //
        //   Tương tự: penaltyBpsAtOpen cũng giữ nguyên để bảo vệ user toàn diện,
        //   không chỉ riêng APR (nhất quán với tinh thần snapshot của Business Rule #1).
        //
        //   planId: giữ nguyên plan cũ (deposits[depositId].planId), KHÔNG đổi plan.
        //   tenorDays: đọc từ plans[deposits[depositId].planId].tenorDays - hợp lệ vì
        //   tenorDays của Plan không có hàm update, nên không cần snapshot riêng.
        deposits[newDepositId] = Deposit({
            planId:          deposits[depositId].planId,
            principal:       newPrincipal,
            maturityAt:      block.timestamp + uint256(plans[deposits[depositId].planId].tenorDays) * 1 days,
            aprBpsAtOpen:    deposits[depositId].aprBpsAtOpen,    // GIỮ APR GỐC - Business Rule #4
            penaltyBpsAtOpen: deposits[depositId].penaltyBpsAtOpen, // GIỮ penalty gốc - nhất quán
            status:          Status.Active
        });

        // INTERACTIONS (2/3): Mint NFT mới cho OWNER đã lưu ở trên - ĐẶT CUỐI CÙNG.
        //   Mint cho owner (không phải msg.sender) vì đây là hành động thay mặt user.
        //   Đặt cuối cùng để tránh reentrancy qua onERC721Received() - giống renewDeposit.
        _safeMint(owner, newDepositId);

        emit Renewed(depositId, newDepositId, newPrincipal, deposits[depositId].planId);
    }
}
