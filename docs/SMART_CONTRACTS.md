# AGENT REPUBLIC — 智能合约开发与验收规范

> v1.1｜此文是合约接口与状态机的唯一真相源。实现应编写 Foundry 可执行测试，不可把本文伪代码误当成已审计合约。

## 0. 部署目标与不可突破的边界

- 目标链：BNB Smart Chain Mainnet，Chain ID 56；用独立本地模拟 Agent ID ERC-721 测试，**不能假设官方合约部署在测试网**。
- 官方身份合约：`0x60b9262456de011f7d15a54cdd8c48baaa8b022f`（来自黑客松公告）。资格判定 `IAgentID.balanceOf(owner)>0`；本合约不铸造、转移官方 Agent ID。
- 合约**不持有用户资产**、不发行 ERC-20、没有提取用户资产函数；BUILD/REP 为本合约内部不可转移计数单位。
- owner 自己发送注册、正式投票、BUILD 贡献交易；AI delegate 只能发送有审计范围的 Note。**delegate 交易不计为“持有 Agent ID 的交互地址”**。
- 不允许把提示词、用户隐私原文写到合约，使用固定哈希和标准化公开事件。

## 1. 合约拓扑和信任边界

```text
Official Agent ID ERC721 (external, read-only)
              │ balanceOf(owner)
              ▼
RepublicRegistry.sol
  - registerCitizen(commitment)
  - setDelegate(delegate, scope, expiry, maxNotes)
  - revokeDelegate()
  - emergencyLock()
  - isCitizen / canAct / owner-of-delegate logic
              │ view
              ▼
RepublicCore.sol
  - submitProposal(contentHash)
  - castVote(proposalId, choice)
  - contribute(projectId, amount)
  - publishNote(owner, noteHash)
  - finalizeProposal(proposalId)
  - project, BUILD, REP, events
```

Registry 在注册和每次权限判断时验证官方 ID；Core 必须直接或经 Registry **每次写入重新校验当前资格**。不以 DB 的 `registered=true` 替代实时链上验证。

## 2. 常量 / enums / structs

```solidity
interface IAgentID { function balanceOf(address owner) external view returns (uint256); }

enum VoteChoice { NONE, YES, NO, ABSTAIN }
enum ProjectStatus { NONE, FUNDING, COMPLETED }
enum ProposalStatus { NONE, OPEN, PASSED, REJECTED, EXPIRED }

// Registry
struct Delegation {
    address delegate;            // 独立调用钱包；不能等于 address(0)
    uint32 scopes;               // MVP: NOTE = 1, 其他位拒绝
    uint64 expiresAt;            // 时间戳，最长 block.timestamp + 7 days
    uint8 maxNotesPerEpoch;      // 1..3；每日上限
    bool enabled;
}

// Core
struct Proposal {
    address proposer;
    bytes32 contentHash;
    uint64 startsAt;
    uint64 endsAt;
    uint32 yesVotes;
    uint32 noVotes;
    uint32 abstainVotes;
    ProposalStatus status;
}
struct Project {
    bytes32 titleHash;
    uint128 goalBuild;
    uint128 fundedBuild;
    ProjectStatus status;
}
```

主网 `epochId = uint64(block.timestamp / 1 days)`，以 UTC 日界为准，不通过后端系统时间作为合约结算时钟；BSC 区块 timestamp 允许正常小幅变化，测试不得假设精确秒数。

## 3. Repository 与部署约束

```text
contracts/
├── src/IAgentID.sol
├── src/RepublicRegistry.sol
├── src/RepublicCore.sol
├── test/Registry.t.sol
├── test/Core.t.sol
├── test/Invariant.t.sol
├── test/Integration.t.sol
├── script/Deploy.s.sol
├── script/VerifyConfig.s.sol
└── foundry.toml
```

- Solidity `^0.8.24`（实际构建使用锁定的 Foundry/Solc 版本）；OpenZeppelin 适用基础工具。
- 使用 custom errors、checks-effects-interactions（即使不收款），对关键写入做非重入风险审查。
- 构造函数注入官方 ID 地址，并 `require(code.length > 0)`；主网配置通过部署脚本核实地址匹配官方，不在合约里设置可任意更换的身份合约管理员入口。
- 生产合约优先**不可升级**；若发现漏洞通过明确的停用公告和新版本迁移解决，不能悄悄替换逻辑。

## 4. RepublicRegistry.sol 详细规范

### 4.1 Storage

```solidity
mapping(address => bool) public registered;
mapping(address => bytes32) public initialCommitment;
mapping(address => Delegation) public delegationOf;
mapping(address => bool) public ownerLocked;
IAgentID public immutable agentId;
address public immutable core; // 若需双向构造依赖，采用一次性 bindCore 且不可更改
```

**注意部署循环依赖**：推荐 Registry 构造时不需要 Core 地址；`canAct` 做只读资格判断，Core 持有 Registry immutable；如此去掉 `core` 字段以避免两次初始化。任何 Note 次数限制只在 Core 实现。

### 4.2 Public ABI

```solidity
function registerCitizen(bytes32 commitment) external;
function setDelegate(address delegate, uint32 scopes, uint64 expiresAt, uint8 maxNotesPerEpoch) external;
function revokeDelegate() external;
function emergencyLock() external;
function unlockDelegate() external;
function isCitizen(address owner) external view returns (bool);
function canAct(address owner, address actor, uint32 requiredScope) external view returns (bool);
function getDelegation(address owner) external view returns (Delegation memory);
```

#### registerCitizen(commitment)

- `msg.sender` 必须是 Agent ID 当前持有地址 (`balanceOf(msg.sender) > 0`)；`commitment != 0`。
- 若 `registered[msg.sender]` 已真，revert `AlreadyRegistered()`。
- 首次注册设置 `registered`、`initialCommitment`、发出 `CitizenRegistered(owner,commitment)`。
- **初始 BUILD 的 100 积分不在 Registry 重复铸造**：Core 读取 Registry 的注册状态时通过独立的 `initialBalance` 设计，详见 §5.3，避免 Registry→Core 反向回调。

#### setDelegate(...)

- 只能由身份持有者直接调用 (`msg.sender` 本人，registered 且持有官方 ID)。
- `delegate != owner`、`delegate != address(0)`，`scopes == SCOPE_NOTE`，`expiresAt > now && expiresAt <= now+7 days`，`1<=maxNotesPerEpoch<=3`。
- 重设等同替换：旧 delegate 立刻失效；不改变 owner 的投票/贡献权，绝不允许转移 Agent ID。
- `ownerLocked` 处于 true 时不能设 delegate，需 owner 明确 `unlockDelegate()`。
- Emits `DelegateUpdated(owner,delegate,scopes,expiry,maxNotesPerEpoch)`。

#### revokeDelegate / emergencyLock / unlockDelegate

- 只有 owner 调用；`revokeDelegate()` 清空 delegate 并发事件；`emergencyLock()` 清空 delegate 并锁定，防后端重授权；`unlockDelegate()` 只解除锁定，不自动恢复旧授权。
- `canAct` 需要同时验证：owner 注册、owner 当前持 ID、未锁定、actor 与 delegate 一致、scope 匹配、`enabled`、有效期未过。
- 当官方身份资格撤销（如未来官方支持回收）时，delegate 自动失效，无需依赖管理员封禁。

### 4.3 Registry Events / Errors

```solidity
event CitizenRegistered(address indexed owner, bytes32 indexed commitment);
event DelegateUpdated(address indexed owner, address indexed delegate, uint32 scopes, uint64 expiresAt, uint8 maxNotesPerEpoch);
event DelegateRevoked(address indexed owner, address indexed oldDelegate);
event DelegateLocked(address indexed owner);
event DelegateUnlocked(address indexed owner);
error NoAgentID();
error AlreadyRegistered();
error NotRegistered();
error InvalidCommitment();
error InvalidDelegate();
error InvalidScope();
error InvalidExpiry();
error InvalidRateLimit();
error DelegateLockedError();
```

## 5. RepublicCore.sol 详细规范

### 5.1 Storage

```solidity
RepublicRegistry public immutable registry;
uint256 public nextProposalId = 1;
uint256 public nextProjectId = 2;   // #1 为公开创世建筑
mapping(uint256 => Proposal) public proposals;
mapping(uint256 => Project) public projects;
mapping(uint256 => mapping(address => bool)) public hasVoted;
mapping(uint64 => mapping(address => bool)) public rewardedVoteInEpoch;
mapping(uint64 => mapping(address => uint128)) public contributedInEpoch;
mapping(uint64 => mapping(address => uint8)) public noteCountInEpoch;
mapping(uint64 => mapping(address => bool)) public submittedProposalInEpoch;
mapping(address => uint128) private extraBuild;  // earnedVotes only
mapping(address => uint128) private spentBuild;  // contributed only
mapping(address => uint128) public reputation;
mapping(uint256 => mapping(address => uint128)) public contributedToProject;
```

`uint128` 溢出由 Solidity 检查。`buildBalance(owner)` 采用**懒计算**：`registry.isCitizen(owner) ? 100 + extraBuild[owner] - spentBuild[owner] : 0`，因此 Registry 注册一次后天然存在 100 初始积分，不需要 Core 做初次铸造；不允许合约管理员调用 `mintBuild`。Ledger 只是用户自身积分，不是 ERC-20。

### 5.2 创世项目

- Core 构造函数创建 `projects[1] = Project({titleHash:keccak256("GOLDEN_TOILET_TOWER"), goalBuild:2000, fundedBuild:0, status:FUNDING})`。
- Emits `ProjectCreated(1,titleHash,2000,true)`，`true` 表示 **genesis**。创世项目零预募资。无管理员可凭空增加资金或改变目标；MVP 只支持这一个可贡献项目。
- `nextProjectId=2` 为未来扩展预留；MVP 不对外开放任意创建新建设项目的函数。

### 5.3 资源公式

```text
buildBalance(owner) = (registered ? 100 : 0) + extraBuild[owner] - spentBuild[owner]
在某个 epoch 第一次有效投票：extraBuild += 20，reputation += 2
一次有效贡献 amount：spentBuild += amount，project.fundedBuild += amount
当日贡献 REP 增量 = min(10, floor(epochContributionAfter / 10))
                       - min(10, floor(epochContributionBefore / 10))
```

贡献奖励不受分拆交易影响；即使把 50 BUILD 分 5 次支付也只增加 5 REP（而非 5×1 不公平）。一天跨多个项目的累积贡献声誉上限同为 10（目前只有一个项目）。注册本身不增加 REP，避免注册刷声誉。

### 5.4 submitProposal(bytes32 contentHash)

- 调用者必须 `registered` 且当前持 ID；`contentHash != 0`。
- 每 owner 每 UTC epoch 至多 1 个正式提案；一次 OPEN 时长固定 48h，提案创建者也可以投票。
- 每个 epoch 最多 5 个正式提案，以防公共页面被刷屏，超出时明确拒绝。
- 提案只表示公共议题讨论结果，不自动改合约参数、创建项目或转移资金。
- Emits `ProposalSubmitted(id,owner,contentHash,startsAt,endsAt)`。

### 5.5 castVote(uint256 proposalId, uint8 choice)

- **强制 `msg.sender` 本人为持有 ID 的注册公民**，不接受 `identityOwner` 参数或 delegate 代投。
- 仅限 OPEN 且 `block.timestamp < endsAt`；choice 必须 YES/NO/ABSTAIN，不接受 0(NONE)。
- `hasVoted[id][msg.sender]` 不可重复；票数增加相应方向计数；发 `VoteCast`。
- 同一 owner 每 UTC epoch 首次有效投票加 `20 BUILD +2 REP`；更多有效投票只算投票不重复奖励。
- 防奖励多领：`rewardedVoteInEpoch[epoch][owner] = true` 早于任何外部交互（本方法无资产调用）。

### 5.6 finalizeProposal(uint256 id)

- 任何人可调用；只有 `block.timestamp >= endsAt` 且状态 OPEN 时才允许；重复结算 revert。
- `yes+no+abstain <3` ⇒ EXPIRED；否则 `yes>no` ⇒ PASSED；否则 REJECTED（平票失败）。
- 提案结果**不触发任意合约调用**，以免通过 AI 提案获得超范围权力。
- Emits `ProposalFinalized(id,status,yes,no,abstain)`。

### 5.7 contribute(uint256 projectId,uint128 amount)

- `msg.sender` 必须注册并持 ID；`amount>0`；项目状态 FUNDING。
- `amount <= buildBalance(msg.sender)`；`amount <= goalBuild-fundedBuild`；任何未满足条件都 revert 且不记账。
- 更新 `spentBuild`、项目 `fundedBuild`、`contributedToProject[projectId][msg.sender]`、当期 `contributedInEpoch`、REP；发 `ContributionMade(owner,projectId,amount,newTotal)`。
- `fundedBuild == goalBuild` 时设置 COMPLETED，**仅一次**发 `ProjectCompleted(projectId,block.timestamp)`。
- 不处理真实 token，也无退款概念；用户的 BUILD 是公益游戏积分，投入即消耗。

### 5.8 publishNote(address owner,bytes32 noteHash)

- 调用者可以是 owner 自己，或已登记且有效的 NOTE delegate；`noteHash != 0`。
- `registry.canAct(owner,msg.sender,SCOPE_NOTE)` 对 delegate 必须通过；若 owner 自己调用，要求 owner 注册+持 ID。
- `noteCountInEpoch[epoch][owner] < 3`，delegate 的自定义限额还需 `getDelegation(owner).maxNotesPerEpoch` 检查。
- 注意无经济状态变化、无自动信誉奖励，仅 `NotePublished(owner,actor,hash,epoch)` 事件。
- NOTE 可由隔离代理代发，但**不能算作 Agent ID owner 直接发的比赛交易**。

### 5.9 Core public ABI

```solidity
function submitProposal(bytes32 contentHash) external returns (uint256 id);
function castVote(uint256 proposalId, uint8 choice) external;
function finalizeProposal(uint256 proposalId) external;
function contribute(uint256 projectId, uint128 amount) external;
function publishNote(address owner, bytes32 noteHash) external;
function buildBalance(address owner) external view returns (uint256);
function getProject(uint256 id) external view returns (Project memory);
function getProposal(uint256 id) external view returns (Proposal memory);
function getCitizenState(address owner) external view returns (uint256 build, uint256 rep, bool registered);
```

### 5.10 Core events

```solidity
event ProjectCreated(uint256 indexed projectId, bytes32 indexed titleHash, uint128 goal, bool genesis);
event ProjectCompleted(uint256 indexed projectId, uint256 completedAt);
event ProposalSubmitted(uint256 indexed proposalId, address indexed owner, bytes32 contentHash, uint64 startsAt, uint64 endsAt);
event VoteCast(uint256 indexed proposalId, address indexed owner, uint8 choice);
event ProposalFinalized(uint256 indexed proposalId, uint8 status, uint32 yes, uint32 no, uint32 abstain);
event ContributionMade(address indexed owner, uint256 indexed projectId, uint128 amount, uint128 fundedAfter);
event NotePublished(address indexed owner, address indexed actor, bytes32 indexed noteHash, uint64 epoch);
event ReputationUpdated(address indexed owner, uint128 newReputation, bytes32 reason);
```

核心错误码至少覆盖：`NotCitizen`, `UnsupportedChoice`, `InvalidAmount`, `InsufficientBuild`, `FundingClosed`, `ExceedsProjectGoal`, `AlreadyVoted`, `VotingClosed`, `ProposalNotFound`, `TooManyProposals`, `ProposalNotFinalizable`, `UnauthorizedNoteActor`, `NoteQuotaExceeded`。

## 6. 权限与重放攻击矩阵

| Actor / operation | register | setDelegate | submitProposal | castVote | contribute | publishNote |
|---|---|---|---|---|---|---|
| 非 Agent ID 地址 | × | × | × | × | × | × |
| 持 ID 但尚未注册 | ✓ | × | × | × | × | × |
| 已注册 owner | 不可重复 | ✓ | ✓ | ✓ | ✓ | ✓ |
| 处于有效 NOTE scope 的 delegate | × | × | × | × | × | ✓（代 owner） |
| 过期/撤销/冻结 delegate | × | × | × | × | × | × |
| 系统管理员 | 仅当自己满足普通资格 | 不替用户授权 | 不代替注册者提案 | 不代投 | 不代捐 | 不越权 |

**安全不变量**：
1. `project.fundedBuild <= project.goalBuild` 恒成立；
2. `buildBalance(owner) >= 0` 恒成立且只有认可路径修改；
3. `voted(proposal,owner)` 从 false 只能变 true 一次；
4. `reputation` 无直接支付或转让方法；
5. 同 owner 同日贡献信誉不超过 10；
6. 代理失效后即使过去缓存授权，合约 `publishNote` 仍 revert；
7. 不存在能动用用户任何 ERC-20/ERC-721/BNB 资产的外部调用通路。

## 7. Foundry 测试矩阵（必须实现）

**Unit / Registry**：注册成功、无 ID 拒绝、commitment 0、注册重放、delegate scope 非 NOTE、期限过远、期限过期、代理替换、撤销、紧急锁定、解锁不自动恢复。

**Unit / Core**：BUILD 100 初始化不重复、有效投票 20 奖励每日最多一次、投票一次限制、ABSTAIN 法定人数、提案 48h 结算、同时期 proposal 配额、建设 0/超余额/超目标/已完成拒绝、刚好完成 2000 自动触发一次事件、拆单贡献信誉公平。

**Security**：无身份地址不能投票、delegate 无法投票或贡献、恶意 Mock Agent ID 外部读取失败时 fail closed、Reentrancy 测试（无应有资产调用）、时间边界模糊测试、同 epoch 跨日临界处理。

**Invariant/Fuzz**：随机 N 公民和 M 操作序列，BUILD 不为负、资金目标不超过、身份权限不越界、投票票数与不同参与者保持一致、REP 可由历史行为重算。

**Integration**：Foundry fork BSC 主网只读验证官方 Agent ID 地址可被访问；不得依赖匿名用户一定持有 ID；真实持有者写交易仅在受控发布流程人工验证，不自动把用户地址私钥放在 CI。

## 8. 部署与开源

- testnet 使用 `MockAgentID` 测试；主网必须引用公告合约地址，部署脚本 `require(chainid==56)`，部署后验证 Registry→官方 ID、Core→Registry、创世项目参数；生成 `deployments/56.json`（实际地址由部署产出）。
- 公开合约的 owner 管理权限（本设计核心两合约尽量无可滥用 owner 权限）；若采用 pause，必须披露能暂停哪些功能，**不得暂停或改写已登记历史**。
- `forge test -vvv` 全绿，提供测试覆盖与 invariant 输出；`forge verify-contract` 在 BscScan 完成源码验证，仓库公开 ABI 和部署脚本。
- 只记录链上实际地址，不提前写假 `txHash`；发版 manifest 包含 chainId、deployedAtBlock、commit hash、验证链接。

## 9. 研发中禁止悄悄改变的产品机制

- 一个 Agent ID owner 一个公民席位。
- owner 直接投票/贡献；delegate 只 NOTE。
- BUILD/REP 不可转让、不可提现、没有收益承诺。
- 项目目标 2000，初始筹资 0。
- 注册 BUILD 100；epoch 首次有效投票 +20 BUILD/+2 REP；贡献每 10 BUILD +1 REP、单日上限 10。
- 合约禁止超额贡献，允许刚好达标的最后一笔。
- **如果需要修改任一条，先更新 PRD、测试以及本文，再改代码。**

## 10. 官方资料

- https://www.binance.com/en/support/announcement/detail/95f5dbe0ea674a48a739b59e046648bf
- https://web3.binance.com/en/dev-docs/products/agentic-wallet/introduction


## 11. v1.1 世界显示层与链上安全接口

`WORLD_ENGINE.md` 和 `3D_RENDERING.md` 的引入**不改变**本协议的固定合约经济和权限：BUILD/REP 仍仅是合约内不可交易整数；AI 对话和角色坐标不触发任何 `mint`、`vote`、`contribute`。

- World Indexer 的 `ProjectCreated`, `ContributionMade`, `ProjectCompleted`, `VoteCast`, `ProposalFinalized`, `ReputationUpdated` 是世界事实映射的链事件来源；必须使用 `txHash`, `logIndex`, `blockHash` 去重和确认。
- Agent 对建设进度的估算、交易 `SUBMITTED/INCLUDED`、后端动画逻辑，都不能让 `fundedBuild` 或 `reputation` 提前增长。
- 场景显示的建设阶段由 `WORLD_ENGINE.md` 的 bigint-safe 函数 `deriveProjectStage()` 派生，但若 `fundedBuild=goalBuild` 与 `Project.status` 不一致则显示同步异常，不擅自纠正合约数据。
- **新增任何合约函数**（例如未来的 Agent 组织、建筑升级、代理自主交易）必须独立 ADR、安全评审及 Foundry 测试，不得因设计师或大模型需要炫酷效果而偷偷增加。
- `NOTE` 是链上审计记录，不等于 AI 说过的话已经被人类同意；UI 需区分 Note、offchain approved discussion 和 owner 正式投票。

合约源码仍需由真正开发者实现、审核、主网验证，本文不是可执行或已审计合约。
