// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAgentID} from "./IAgentID.sol";

/// @title RepublicRegistry — citizenship registry on top of the official
///        Binance Agent ID ERC-721.
/// @dev Spec: docs/SMART_CONTRACTS.md §4. This contract:
///      - never mints/transfers Agent IDs, only reads balanceOf;
///      - holds no user assets and has no admin functions;
///      - treats `registered` + current ID ownership as live citizenship
///        (`isCitizen` re-checks balanceOf on every call);
///      - delegates are NOTE-only, time-boxed (<= 7 days) and replaceable.
///        canAct(owner, owner, ...) intentionally returns false: the owner
///        path is handled by callers directly (spec §5.8).
contract RepublicRegistry {
    // ---------------------------------------------------------------- types
    struct Delegation {
        address delegate; // independent calling wallet; never address(0)
        uint32 scopes; // MVP: NOTE = 1, all other bits rejected
        uint64 expiresAt; // timestamp, at most block.timestamp + 7 days
        uint8 maxNotesPerEpoch; // 1..3 daily cap
        bool enabled;
    }

    // ------------------------------------------------------------ constants
    uint32 public constant SCOPE_NOTE = 1;
    uint64 public constant MAX_DELEGATION_TTL = 7 days;
    uint8 public constant MIN_NOTES_PER_EPOCH = 1;
    uint8 public constant MAX_NOTES_PER_EPOCH = 3;

    // -------------------------------------------------------------- storage
    mapping(address => bool) public registered;
    mapping(address => bytes32) public initialCommitment;
    mapping(address => Delegation) public delegationOf;
    mapping(address => bool) public ownerLocked;
    IAgentID public immutable agentId;

    // --------------------------------------------------------------- events
    event CitizenRegistered(address indexed owner, bytes32 indexed commitment);
    event DelegateUpdated(
        address indexed owner, address indexed delegate, uint32 scopes, uint64 expiresAt, uint8 maxNotesPerEpoch
    );
    event DelegateRevoked(address indexed owner, address indexed oldDelegate);
    event DelegateLocked(address indexed owner);
    event DelegateUnlocked(address indexed owner);

    // --------------------------------------------------------------- errors
    error NoAgentID();
    error AlreadyRegistered();
    error NotRegistered();
    error InvalidCommitment();
    error InvalidDelegate();
    error InvalidScope();
    error InvalidExpiry();
    error InvalidRateLimit();
    error DelegateLockedError();
    error InvalidAgentIDContract();

    // ------------------------------------------------------------- modifier
    modifier onlyCitizen() {
        if (!registered[msg.sender]) revert NotRegistered();
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentID();
        _;
    }

    // ----------------------------------------------------------- constructor
    /// @param agentId_ official Agent ID contract (mainnet) or MockAgentID (testnet).
    constructor(address agentId_) {
        if (agentId_ == address(0)) revert InvalidAgentIDContract();
        if (agentId_.code.length == 0) revert InvalidAgentIDContract();
        agentId = IAgentID(agentId_);
    }

    // ---------------------------------------------------------- registration
    /// @notice Register msg.sender as a citizen. Must currently hold an Agent ID.
    ///         The initial 100 BUILD is NOT minted here; RepublicCore lazily
    ///         derives it from registration state (spec §5.3).
    function registerCitizen(bytes32 commitment) external {
        if (agentId.balanceOf(msg.sender) == 0) revert NoAgentID();
        if (registered[msg.sender]) revert AlreadyRegistered();
        if (commitment == bytes32(0)) revert InvalidCommitment();

        registered[msg.sender] = true;
        initialCommitment[msg.sender] = commitment;

        emit CitizenRegistered(msg.sender, commitment);
    }

    // ------------------------------------------------------------ delegation
    /// @notice Set (or replace) the NOTE-only delegate. The previous delegate
    ///         is invalidated immediately. Not callable while locked.
    function setDelegate(address delegate, uint32 scopes, uint64 expiresAt, uint8 maxNotesPerEpoch)
        external
        onlyCitizen
    {
        if (ownerLocked[msg.sender]) revert DelegateLockedError();
        if (delegate == address(0) || delegate == msg.sender) revert InvalidDelegate();
        if (scopes != SCOPE_NOTE) revert InvalidScope();
        if (expiresAt <= block.timestamp || expiresAt > block.timestamp + MAX_DELEGATION_TTL) {
            revert InvalidExpiry();
        }
        if (maxNotesPerEpoch < MIN_NOTES_PER_EPOCH || maxNotesPerEpoch > MAX_NOTES_PER_EPOCH) {
            revert InvalidRateLimit();
        }

        delegationOf[msg.sender] = Delegation({
            delegate: delegate, scopes: scopes, expiresAt: expiresAt, maxNotesPerEpoch: maxNotesPerEpoch, enabled: true
        });

        emit DelegateUpdated(msg.sender, delegate, scopes, expiresAt, maxNotesPerEpoch);
    }

    /// @notice Clear the current delegate. Does not change the lock flag.
    function revokeDelegate() external {
        if (!registered[msg.sender]) revert NotRegistered();
        address oldDelegate = delegationOf[msg.sender].delegate;
        delete delegationOf[msg.sender];
        emit DelegateRevoked(msg.sender, oldDelegate);
    }

    /// @notice Clear the delegate AND lock the account so no new delegation
    ///         can be created (protects against a compromised backend key).
    function emergencyLock() external {
        if (!registered[msg.sender]) revert NotRegistered();
        ownerLocked[msg.sender] = true;
        delete delegationOf[msg.sender];
        emit DelegateLocked(msg.sender);
    }

    /// @notice Lift the lock only. Does NOT restore any previous delegation.
    function unlockDelegate() external {
        if (!registered[msg.sender]) revert NotRegistered();
        ownerLocked[msg.sender] = false;
        emit DelegateUnlocked(msg.sender);
    }

    // ----------------------------------------------------------------- views
    /// @notice Live citizenship = registered AND currently holding an Agent ID.
    ///         Callers must use this (not raw `registered`) for permission
    ///         checks so a lost/transferred ID disables the account without
    ///         any admin intervention.
    function isCitizen(address owner) external view returns (bool) {
        return registered[owner] && agentId.balanceOf(owner) > 0;
    }

    /// @notice Full delegate permission check. Returns false (never reverts)
    ///         for: unregistered owner, owner without ID, locked owner,
    ///         wrong actor, disabled delegation, scope mismatch, expiry.
    function canAct(address owner, address actor, uint32 requiredScope) external view returns (bool) {
        if (!registered[owner]) return false;
        if (agentId.balanceOf(owner) == 0) return false;
        if (ownerLocked[owner]) return false;

        Delegation storage d = delegationOf[owner];
        if (actor != d.delegate) return false;
        if (!d.enabled) return false;
        if (d.scopes & requiredScope == 0) return false;
        if (block.timestamp >= d.expiresAt) return false;

        return true;
    }

    function getDelegation(address owner) external view returns (Delegation memory) {
        return delegationOf[owner];
    }
}
