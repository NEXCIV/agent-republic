// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {RepublicRegistry} from "./RepublicRegistry.sol";

/// @title RepublicCore — proposals, votes, contributions and NOTEs.
/// @dev Spec: docs/SMART_CONTRACTS.md §5. Key properties:
///      - Every write re-validates live citizenship via the Registry
///        (`registered` AND current Agent ID ownership) — never a cached flag.
///      - BUILD/REP are internal, non-transferable integers; there is no
///        mintBuild, no admin, no arbitrary external call path.
///      - The initial 100 BUILD is lazily derived from registration state
///        (spec §5.3), not minted.
///      - Genesis project #1 "GOLDEN_TOILET_TOWER": goal 2000, funded 0.
contract RepublicCore {
    // ---------------------------------------------------------------- types
    enum VoteChoice {
        NONE,
        YES,
        NO,
        ABSTAIN
    }
    enum ProjectStatus {
        NONE,
        FUNDING,
        COMPLETED
    }
    enum ProposalStatus {
        NONE,
        OPEN,
        PASSED,
        REJECTED,
        EXPIRED
    }

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

    // ------------------------------------------------------------ constants
    uint128 public constant INITIAL_BUILD = 100;
    uint128 public constant VOTE_BUILD_REWARD = 20;
    uint128 public constant VOTE_REP_REWARD = 2;
    uint128 public constant BUILD_PER_REP = 10; // contribution: 10 BUILD => 1 REP
    uint128 public constant DAILY_CONTRIB_REP_CAP = 10;
    uint64 public constant PROPOSAL_DURATION = 48 hours;
    uint32 public constant PROPOSAL_QUORUM = 3;
    uint32 public constant MAX_PROPOSALS_PER_EPOCH = 5;
    uint8 public constant MAX_NOTES_PER_EPOCH = 3;

    bytes32 public constant GENESIS_TITLE = keccak256("GOLDEN_TOILET_TOWER");
    uint128 public constant GENESIS_GOAL = 2000;
    uint256 public constant GENESIS_PROJECT_ID = 1;

    bytes32 public constant REASON_VOTE_REWARD = keccak256("VOTE_REWARD");
    bytes32 public constant REASON_CONTRIB_REWARD = keccak256("CONTRIB_REWARD");

    // -------------------------------------------------------------- storage
    RepublicRegistry public immutable registry;
    uint256 public nextProposalId = 1;
    uint256 public nextProjectId = 2; // #1 is the genesis building

    mapping(uint256 => Proposal) public proposals;
    mapping(uint256 => Project) public projects;
    mapping(uint256 => mapping(address => bool)) public hasVoted;
    mapping(uint64 => mapping(address => bool)) public rewardedVoteInEpoch;
    mapping(uint64 => mapping(address => uint128)) public contributedInEpoch;
    mapping(uint64 => mapping(address => uint8)) public noteCountInEpoch;
    mapping(uint64 => mapping(address => bool)) public submittedProposalInEpoch;
    mapping(uint64 => uint32) internal proposalsInEpoch;

    mapping(address => uint128) private extraBuild; // earned via votes only
    mapping(address => uint128) private spentBuild; // consumed via contributions only
    mapping(address => uint128) public reputation;
    mapping(uint256 => mapping(address => uint128)) public contributedToProject;

    // --------------------------------------------------------------- events
    event ProjectCreated(uint256 indexed projectId, bytes32 indexed titleHash, uint128 goal, bool genesis);
    event ProjectCompleted(uint256 indexed projectId, uint64 completedAt);
    event ProposalSubmitted(
        uint256 indexed proposalId, address indexed owner, bytes32 contentHash, uint64 startsAt, uint64 endsAt
    );
    event VoteCast(uint256 indexed proposalId, address indexed owner, uint8 choice);
    event ProposalFinalized(uint256 indexed proposalId, uint8 status, uint32 yes, uint32 no, uint32 abstain);
    event ContributionMade(address indexed owner, uint256 indexed projectId, uint128 amount, uint128 fundedAfter);
    event NotePublished(address indexed owner, address indexed actor, bytes32 indexed noteHash, uint64 epoch);
    event ReputationUpdated(address indexed owner, uint128 newReputation, bytes32 reason);

    // --------------------------------------------------------------- errors
    error NotCitizen();
    error UnsupportedChoice();
    error InvalidAmount();
    error InsufficientBuild();
    error FundingClosed();
    error ExceedsProjectGoal();
    error AlreadyVoted();
    error VotingClosed();
    error ProposalNotFound();
    error TooManyProposals();
    error ProposalNotFinalizable();
    error UnauthorizedNoteActor();
    error NoteQuotaExceeded();
    error InvalidContentHash();
    error ProjectNotFound();
    error InvalidRegistry();

    // ------------------------------------------------------------- modifier
    modifier onlyCitizen() {
        if (!registry.isCitizen(msg.sender)) revert NotCitizen();
        _;
    }

    // ----------------------------------------------------------- constructor
    constructor(address registry_) {
        if (registry_ == address(0)) revert InvalidRegistry();
        if (registry_.code.length == 0) revert InvalidRegistry();
        registry = RepublicRegistry(registry_);

        // Genesis project #1: zero pre-funding, fixed goal, no admin override.
        projects[GENESIS_PROJECT_ID] =
            Project({titleHash: GENESIS_TITLE, goalBuild: GENESIS_GOAL, fundedBuild: 0, status: ProjectStatus.FUNDING});
        emit ProjectCreated(GENESIS_PROJECT_ID, GENESIS_TITLE, GENESIS_GOAL, true);
    }

    // ------------------------------------------------------------- internal
    function _currentEpoch() internal view returns (uint64) {
        return uint64(block.timestamp / 1 days);
    }

    /// @dev REP delta for a contribution of `amount` within the current epoch,
    ///      computed from the epoch's cumulative contribution so split
    ///      transactions cannot earn more than a single equivalent one.
    function _contributionRepDelta(uint128 contributedBefore, uint128 contributedAfter)
        internal
        pure
        returns (uint128)
    {
        uint128 repBefore = contributedBefore / BUILD_PER_REP < DAILY_CONTRIB_REP_CAP
            ? contributedBefore / BUILD_PER_REP
            : DAILY_CONTRIB_REP_CAP;
        uint128 repAfter = contributedAfter / BUILD_PER_REP < DAILY_CONTRIB_REP_CAP
            ? contributedAfter / BUILD_PER_REP
            : DAILY_CONTRIB_REP_CAP;
        return repAfter - repBefore;
    }

    // ------------------------------------------------------- proposals/votes
    /// @notice Submit a public-topic proposal. One per citizen per UTC epoch,
    ///         at most 5 per epoch network-wide. 48h open window.
    function submitProposal(bytes32 contentHash) external onlyCitizen returns (uint256 id) {
        if (contentHash == bytes32(0)) revert InvalidContentHash();

        uint64 epoch = _currentEpoch();
        if (submittedProposalInEpoch[epoch][msg.sender]) revert TooManyProposals();
        if (proposalsInEpoch[epoch] >= MAX_PROPOSALS_PER_EPOCH) revert TooManyProposals();

        submittedProposalInEpoch[epoch][msg.sender] = true;
        proposalsInEpoch[epoch] += 1;

        id = nextProposalId++;
        uint64 startsAt = uint64(block.timestamp);
        proposals[id] = Proposal({
            proposer: msg.sender,
            contentHash: contentHash,
            startsAt: startsAt,
            endsAt: startsAt + PROPOSAL_DURATION,
            yesVotes: 0,
            noVotes: 0,
            abstainVotes: 0,
            status: ProposalStatus.OPEN
        });

        emit ProposalSubmitted(id, msg.sender, contentHash, startsAt, startsAt + PROPOSAL_DURATION);
    }

    /// @notice Cast a vote. Strictly personal: the sender must be a live
    ///         citizen; delegates can never vote on behalf of an owner.
    function castVote(uint256 proposalId, uint8 choice) external onlyCitizen {
        Proposal storage p = proposals[proposalId];
        if (p.status == ProposalStatus.NONE) revert ProposalNotFound();
        if (p.status != ProposalStatus.OPEN || block.timestamp >= p.endsAt) revert VotingClosed();
        if (choice != uint8(VoteChoice.YES) && choice != uint8(VoteChoice.NO) && choice != uint8(VoteChoice.ABSTAIN)) {
            revert UnsupportedChoice();
        }
        if (hasVoted[proposalId][msg.sender]) revert AlreadyVoted();

        hasVoted[proposalId][msg.sender] = true;
        if (choice == uint8(VoteChoice.YES)) {
            p.yesVotes += 1;
        } else if (choice == uint8(VoteChoice.NO)) {
            p.noVotes += 1;
        } else {
            p.abstainVotes += 1;
        }

        // First effective vote in the epoch earns +20 BUILD / +2 REP.
        // Mark before anything else (no asset interactions in this path).
        uint64 epoch = _currentEpoch();
        if (!rewardedVoteInEpoch[epoch][msg.sender]) {
            rewardedVoteInEpoch[epoch][msg.sender] = true;
            extraBuild[msg.sender] += VOTE_BUILD_REWARD;
            reputation[msg.sender] += VOTE_REP_REWARD;
            emit ReputationUpdated(msg.sender, reputation[msg.sender], REASON_VOTE_REWARD);
        }

        emit VoteCast(proposalId, msg.sender, choice);
    }

    /// @notice Finalize a proposal after its 48h window. Anyone can call.
    ///         < 3 total votes => EXPIRED; otherwise yes>no => PASSED,
    ///         else REJECTED (ties fail). No arbitrary follow-up calls.
    function finalizeProposal(uint256 proposalId) external {
        Proposal storage p = proposals[proposalId];
        if (p.status == ProposalStatus.NONE) revert ProposalNotFound();
        if (p.status != ProposalStatus.OPEN || block.timestamp < p.endsAt) revert ProposalNotFinalizable();

        uint32 total = p.yesVotes + p.noVotes + p.abstainVotes;
        if (total < PROPOSAL_QUORUM) {
            p.status = ProposalStatus.EXPIRED;
        } else if (p.yesVotes > p.noVotes) {
            p.status = ProposalStatus.PASSED;
        } else {
            p.status = ProposalStatus.REJECTED;
        }

        emit ProposalFinalized(proposalId, uint8(p.status), p.yesVotes, p.noVotes, p.abstainVotes);
    }

    // --------------------------------------------------------- contributions
    /// @notice Consume BUILD toward a funding project. BUILD is a public-good
    ///         game score: spent forever, no refunds, no real tokens.
    function contribute(uint256 projectId, uint128 amount) external onlyCitizen {
        Project storage project = projects[projectId];
        if (project.status == ProjectStatus.NONE) revert ProjectNotFound();
        if (amount == 0) revert InvalidAmount();
        if (project.status != ProjectStatus.FUNDING) revert FundingClosed();
        if (amount > buildBalance(msg.sender)) revert InsufficientBuild();
        uint128 remaining = project.goalBuild - project.fundedBuild;
        if (amount > remaining) revert ExceedsProjectGoal();

        spentBuild[msg.sender] += amount;
        project.fundedBuild += amount;
        contributedToProject[projectId][msg.sender] += amount;

        uint64 epoch = _currentEpoch();
        uint128 contributedBefore = contributedInEpoch[epoch][msg.sender];
        uint128 contributedAfter = contributedBefore + amount;
        contributedInEpoch[epoch][msg.sender] = contributedAfter;

        uint128 repDelta = _contributionRepDelta(contributedBefore, contributedAfter);
        if (repDelta > 0) {
            reputation[msg.sender] += repDelta;
            emit ReputationUpdated(msg.sender, reputation[msg.sender], REASON_CONTRIB_REWARD);
        }

        emit ContributionMade(msg.sender, projectId, amount, project.fundedBuild);

        if (project.fundedBuild == project.goalBuild) {
            project.status = ProjectStatus.COMPLETED;
            emit ProjectCompleted(projectId, uint64(block.timestamp));
        }
    }

    // ----------------------------------------------------------------- NOTEs
    /// @notice Publish an auditable NOTE (hash only). The actor is either the
    ///         owner (live citizen) or a valid NOTE-scope delegate. Notes carry
    ///         no economic state change and no reputation.
    function publishNote(address owner, bytes32 noteHash) external {
        if (noteHash == bytes32(0)) revert InvalidContentHash();

        bool isOwner = msg.sender == owner;
        if (isOwner) {
            if (!registry.isCitizen(owner)) revert NotCitizen();
        } else {
            if (!registry.canAct(owner, msg.sender, registry.SCOPE_NOTE())) {
                revert UnauthorizedNoteActor();
            }
        }

        uint64 epoch = _currentEpoch();
        uint8 count = noteCountInEpoch[epoch][owner];
        if (count >= MAX_NOTES_PER_EPOCH) revert NoteQuotaExceeded();
        if (!isOwner && count >= registry.getDelegation(owner).maxNotesPerEpoch) {
            revert NoteQuotaExceeded();
        }

        noteCountInEpoch[epoch][owner] = count + 1;
        emit NotePublished(owner, msg.sender, noteHash, epoch);
    }

    // ----------------------------------------------------------------- views
    /// @notice Lazy BUILD balance: citizenship + 100 initial + vote rewards
    ///         - contributions. Not an ERC-20; not transferable.
    function buildBalance(address owner) public view returns (uint256) {
        if (!registry.isCitizen(owner)) return 0;
        return uint256(INITIAL_BUILD) + uint256(extraBuild[owner]) - uint256(spentBuild[owner]);
    }

    function getProject(uint256 id) external view returns (Project memory) {
        return projects[id];
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        return proposals[id];
    }

    function getCitizenState(address owner) external view returns (uint256 build, uint256 rep, bool registered) {
        return (buildBalance(owner), reputation[owner], registry.registered(owner));
    }
}
