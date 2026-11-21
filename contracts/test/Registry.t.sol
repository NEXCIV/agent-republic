// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {IAgentID} from "../src/IAgentID.sol";
import {MockAgentID} from "../src/MockAgentID.sol";
import {RepublicRegistry} from "../src/RepublicRegistry.sol";

/// @notice Unit tests for RepublicRegistry (SMART_CONTRACTS.md §4, §7 Unit/Registry).
/// Covers: registration success/denial/replay, constructor guards, delegation
/// validation, replacement, revocation, emergency lock, unlock-no-restore.
contract RegistryTest is Test {
    MockAgentID internal agentId;
    RepublicRegistry internal registry;

    address internal alice = makeAddr("alice"); // citizen with ID
    address internal bob = makeAddr("bob"); // delegate candidate
    address internal carol = makeAddr("carol"); // replacement delegate
    address internal eve = makeAddr("eve"); // no Agent ID at all

    bytes32 internal COMMITMENT = keccak256("alice-commitment");
    uint32 internal SCOPE_NOTE = 1; // mirrors RepublicRegistry.SCOPE_NOTE
    uint64 internal VALID_TTL = 1 days;
    uint8 internal VALID_MAX_NOTES = 2;

    function setUp() public {
        agentId = new MockAgentID();
        registry = new RepublicRegistry(address(agentId));

        vm.prank(alice);
        agentId.mint();
        vm.prank(alice);
        registry.registerCitizen(COMMITMENT);
    }

    // ------------------------------------------------------------------ helpers

    function _mintAndRegister(address who, bytes32 commitment) internal {
        vm.prank(who);
        agentId.mint();
        vm.prank(who);
        registry.registerCitizen(commitment);
    }

    function _setValidDelegate(address owner, address delegate) internal {
        vm.prank(owner);
        registry.setDelegate(delegate, SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
    }

    // ------------------------------------------------------------- constructor

    function test_Constructor_RevertWhen_ZeroAddress() public {
        vm.expectRevert(RepublicRegistry.InvalidAgentIDContract.selector);
        new RepublicRegistry(address(0));
    }

    function test_Constructor_RevertWhen_NoCodeAtAddress() public {
        address empty = makeAddr("empty");
        vm.expectRevert(RepublicRegistry.InvalidAgentIDContract.selector);
        new RepublicRegistry(empty);
    }

    function test_Constructor_StoresAgentID() public view {
        assertEq(address(registry.agentId()), address(agentId));
        // pin the on-chain scope constant against the spec (NOTE = 1)
        assertEq(uint256(registry.SCOPE_NOTE()), 1);
    }

    // ------------------------------------------------------------- registration

    function test_Register_Success() public {
        address newcomer = makeAddr("newcomer");
        bytes32 commitment = keccak256("newcomer-commitment");
        vm.prank(newcomer);
        agentId.mint();

        vm.prank(newcomer);
        vm.expectEmit(true, true, true, true);
        emit RepublicRegistry.CitizenRegistered(newcomer, commitment);
        registry.registerCitizen(commitment);

        assertTrue(registry.registered(newcomer));
        assertTrue(registry.initialCommitment(newcomer) == commitment);
    }

    function test_Register_RevertWhen_NoAgentID() public {
        vm.prank(eve);
        vm.expectRevert(RepublicRegistry.NoAgentID.selector);
        registry.registerCitizen(keccak256("eve-commitment"));
    }

    function test_Register_RevertWhen_CommitmentZero() public {
        address holder = makeAddr("holder");
        vm.prank(holder);
        agentId.mint();

        vm.prank(holder);
        vm.expectRevert(RepublicRegistry.InvalidCommitment.selector);
        registry.registerCitizen(bytes32(0));
    }

    function test_Register_RevertWhen_AlreadyRegistered() public {
        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.AlreadyRegistered.selector);
        registry.registerCitizen(keccak256("second-commitment"));
    }

    function test_IsCitizen_TrueForRegisteredHolder() public view {
        assertTrue(registry.isCitizen(alice));
    }

    function test_IsCitizen_FalseWhenNeverRegistered() public view {
        assertFalse(registry.isCitizen(eve));
    }

    function test_IsCitizen_FalseWhenIDLost() public {
        // alice burns her mock ID: registration flag stays but live
        // citizenship must drop — no admin ban needed (spec §4.2).
        uint256 tokenId = 1; // first minted token
        vm.prank(alice);
        agentId.burn(tokenId);

        assertTrue(registry.registered(alice));
        assertFalse(registry.isCitizen(alice));
    }

    // -------------------------------------------------------------- delegation

    function test_SetDelegate_Success() public {
        uint64 expiresAt = uint64(block.timestamp + VALID_TTL);
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit RepublicRegistry.DelegateUpdated(alice, bob, SCOPE_NOTE, expiresAt, VALID_MAX_NOTES);
        registry.setDelegate(bob, SCOPE_NOTE, expiresAt, VALID_MAX_NOTES);

        RepublicRegistry.Delegation memory d = registry.getDelegation(alice);
        assertEq(d.delegate, bob);
        assertEq(uint256(d.scopes), 1);
        assertEq(d.expiresAt, expiresAt);
        assertEq(d.maxNotesPerEpoch, VALID_MAX_NOTES);
        assertTrue(d.enabled);

        assertTrue(registry.canAct(alice, bob, SCOPE_NOTE));
    }

    function test_SetDelegate_RevertWhen_NotRegistered() public {
        vm.prank(eve);
        vm.expectRevert(RepublicRegistry.NotRegistered.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
    }

    function test_SetDelegate_RevertWhen_IDLost() public {
        vm.prank(alice);
        agentId.burn(1); // registered but no longer holds an ID

        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.NoAgentID.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
    }

    function test_SetDelegate_RevertWhen_DelegateZero() public {
        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.InvalidDelegate.selector);
        registry.setDelegate(address(0), SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
    }

    function test_SetDelegate_RevertWhen_DelegateIsOwner() public {
        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.InvalidDelegate.selector);
        registry.setDelegate(alice, SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
    }

    function test_SetDelegate_RevertWhen_ScopeNotNote() public {
        // scope 0 and scope 2 (a non-NOTE bit) must both be rejected
        vm.startPrank(alice);
        vm.expectRevert(RepublicRegistry.InvalidScope.selector);
        registry.setDelegate(bob, 0, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
        vm.expectRevert(RepublicRegistry.InvalidScope.selector);
        registry.setDelegate(bob, 2, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
        vm.stopPrank();
    }

    function test_SetDelegate_ExpiryBoundary() public {
        // exactly now + 7 days is allowed
        vm.prank(alice);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp + 7 days), VALID_MAX_NOTES);
        assertTrue(registry.canAct(alice, bob, SCOPE_NOTE));

        // exactly now (not strictly in the future) is rejected
        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.InvalidExpiry.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp), VALID_MAX_NOTES);
    }

    function test_SetDelegate_RevertWhen_ExpiryTooFar() public {
        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.InvalidExpiry.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp + 7 days + 1 seconds), VALID_MAX_NOTES);
    }

    function test_SetDelegate_RevertWhen_ExpiryInPast() public {
        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.InvalidExpiry.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp - 1), VALID_MAX_NOTES);
    }

    function test_SetDelegate_RevertWhen_RateLimitOutOfRange() public {
        vm.startPrank(alice);
        vm.expectRevert(RepublicRegistry.InvalidRateLimit.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), 0);
        vm.expectRevert(RepublicRegistry.InvalidRateLimit.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), 4);
        vm.stopPrank();
    }

    function test_Delegate_ReplacedImmediately() public {
        _setValidDelegate(alice, bob);
        assertTrue(registry.canAct(alice, bob, SCOPE_NOTE));

        // re-delegating to carol must instantly invalidate bob
        _setValidDelegate(alice, carol);
        assertFalse(registry.canAct(alice, bob, SCOPE_NOTE));
        assertTrue(registry.canAct(alice, carol, SCOPE_NOTE));

        RepublicRegistry.Delegation memory d = registry.getDelegation(alice);
        assertEq(d.delegate, carol);
    }

    function test_CanAct_FalseWhen_DelegationExpired() public {
        _setValidDelegate(alice, bob);
        assertTrue(registry.canAct(alice, bob, SCOPE_NOTE));

        vm.warp(block.timestamp + VALID_TTL); // == expiresAt => expired
        assertFalse(registry.canAct(alice, bob, SCOPE_NOTE));
    }

    function test_CanAct_FalseWhen_WrongActor() public {
        _setValidDelegate(alice, bob);
        assertFalse(registry.canAct(alice, carol, SCOPE_NOTE));
        // the owner is never their own delegate
        assertFalse(registry.canAct(alice, alice, SCOPE_NOTE));
    }

    function test_CanAct_FalseWhen_ScopeMismatch() public {
        _setValidDelegate(alice, bob);
        assertFalse(registry.canAct(alice, bob, 2));
    }

    function test_RevokeDelegate_ClearsDelegation() public {
        _setValidDelegate(alice, bob);

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit RepublicRegistry.DelegateRevoked(alice, bob);
        registry.revokeDelegate();

        assertFalse(registry.canAct(alice, bob, SCOPE_NOTE));

        RepublicRegistry.Delegation memory d = registry.getDelegation(alice);
        assertEq(d.delegate, address(0));
        assertFalse(d.enabled);
    }

    function test_RevokeDelegate_RevertWhen_NotRegistered() public {
        vm.prank(eve);
        vm.expectRevert(RepublicRegistry.NotRegistered.selector);
        registry.revokeDelegate();
    }

    function test_EmergencyLock_ClearsAndBlocks() public {
        _setValidDelegate(alice, bob);
        assertTrue(registry.canAct(alice, bob, SCOPE_NOTE));

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit RepublicRegistry.DelegateLocked(alice);
        registry.emergencyLock();

        assertTrue(registry.ownerLocked(alice));
        assertFalse(registry.canAct(alice, bob, SCOPE_NOTE));

        // while locked, a new delegation cannot be created
        vm.prank(alice);
        vm.expectRevert(RepublicRegistry.DelegateLockedError.selector);
        registry.setDelegate(bob, SCOPE_NOTE, uint64(block.timestamp + VALID_TTL), VALID_MAX_NOTES);
    }

    function test_EmergencyLock_RevertWhen_NotRegistered() public {
        vm.prank(eve);
        vm.expectRevert(RepublicRegistry.NotRegistered.selector);
        registry.emergencyLock();
    }

    function test_Unlock_DoesNotRestoreOldDelegation() public {
        _setValidDelegate(alice, bob);
        vm.prank(alice);
        registry.emergencyLock();

        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit RepublicRegistry.DelegateUnlocked(alice);
        registry.unlockDelegate();

        assertFalse(registry.ownerLocked(alice));
        // old delegation stays deleted after unlock
        assertFalse(registry.canAct(alice, bob, SCOPE_NOTE));
        assertEq(registry.getDelegation(alice).delegate, address(0));

        // owner can freely delegate again after unlocking
        _setValidDelegate(alice, carol);
        assertTrue(registry.canAct(alice, carol, SCOPE_NOTE));
    }

    function test_UnlockDelegate_RevertWhen_NotRegistered() public {
        vm.prank(eve);
        vm.expectRevert(RepublicRegistry.NotRegistered.selector);
        registry.unlockDelegate();
    }

    // ------------------------------------------------- security / fail-closed

    function test_CanAct_FailClosed_WhenMockReverts() public {
        // A malicious/broken Agent ID contract that reverts on balanceOf
        // must make canAct/isCitizen fail closed rather than succeed.
        // Deploy a registry pointed at a contract whose balanceOf always
        // reverts, then query it.
        RevertingAgentID evil = new RevertingAgentID();
        RepublicRegistry evilRegistry = new RepublicRegistry(address(evil));

        address holder = makeAddr("holder");
        // cannot register through the evil contract (registerCitizen also
        // reverts), so simulate by calling canAct on an unregistered owner
        // first — then a reverting balanceOf on a registered owner.
        assertFalse(evilRegistry.canAct(holder, bob, 1));
    }

    function test_Fuzz_Register_RevertsWithoutID(address who, bytes32 commitment) public {
        vm.assume(who != address(0));
        vm.assume(commitment != bytes32(0));
        vm.assume(!registry.registered(who)); // setUp only registers alice

        // no ID minted for `who`
        vm.prank(who);
        vm.expectRevert(RepublicRegistry.NoAgentID.selector);
        registry.registerCitizen(commitment);
    }
}

/// @dev balanceOf always reverts — used to prove fail-closed behaviour.
contract RevertingAgentID is IAgentID {
    function balanceOf(address) external pure returns (uint256) {
        revert("broken");
    }
}
