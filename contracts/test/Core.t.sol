// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {MockAgentID} from "../src/MockAgentID.sol";
import {RepublicRegistry} from "../src/RepublicRegistry.sol";
import {RepublicCore} from "../src/RepublicCore.sol";

/// @notice Unit tests for RepublicCore (SMART_CONTRACTS.md §5, §7 Unit/Core
/// plus Security rows). Numeric expectations are pinned to the spec:
/// 100 initial BUILD, +20/+2 per-epoch first vote, 48h proposals, quorum 3,
/// max 5 proposals/epoch, genesis goal 2000, REP 1 per 10 BUILD capped 10/day.
contract CoreTest is Test {
    MockAgentID internal agentId;
    RepublicRegistry internal registry;
    RepublicCore internal core;

    // citizens (mint mock Agent ID + register)
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal dave = makeAddr("dave");
    address internal erin = makeAddr("erin");
    address internal gina = makeAddr("gina");
    // pure delegate wallet for alice (NOTE-only, never a citizen)
    address internal frank = makeAddr("frank");
    // no Agent ID at all
    address internal eve = makeAddr("eve");

    bytes32 internal constant PROPOSAL_HASH = keccak256("proposal-content-1");
    bytes32 internal constant PROPOSAL_HASH_2 = keccak256("proposal-content-2");
    bytes32 internal constant NOTE_HASH = keccak256("note-content-1");

    uint32 internal constant SCOPE_NOTE = 1;

    function setUp() public {
        agentId = new MockAgentID();
        registry = new RepublicRegistry(address(agentId));

        vm.expectEmit(true, true, true, true);
        emit RepublicCore.ProjectCreated(1, keccak256("GOLDEN_TOILET_TOWER"), 2000, true);
        core = new RepublicCore(address(registry));

        address[6] memory citizens = [alice, bob, carol, dave, erin, gina];
        for (uint256 i = 0; i < citizens.length; i++) {
            _mintAndRegister(citizens[i], keccak256(abi.encodePacked("commit-", citizens[i])));
        }

        // alice delegates NOTE-only rights to frank, max 2 notes per epoch
        vm.prank(alice);
        registry.setDelegate(frank, SCOPE_NOTE, uint64(block.timestamp + 7 days), 2);
    }

    // ------------------------------------------------------------------ helpers

    function _mintAndRegister(address who, bytes32 commitment) internal {
        vm.prank(who);
        agentId.mint();
        vm.prank(who);
        registry.registerCitizen(commitment);
    }

    function _submit(address who, bytes32 contentHash) internal returns (uint256 id) {
        vm.prank(who);
        return core.submitProposal(contentHash);
    }

    function _vote(address who, uint256 proposalId, uint8 choice) internal {
        vm.prank(who);
        core.castVote(proposalId, choice);
    }

    function _contribute(address who, uint128 amount) internal {
        vm.prank(who);
        core.contribute(1, amount);
    }

    // ------------------------------------------------------- genesis project

    function test_GenesisProject_Params() public view {
        RepublicCore.Project memory p = core.getProject(1);
        assertEq(uint8(p.status), uint8(RepublicCore.ProjectStatus.FUNDING));
        assertEq(uint256(p.goalBuild), 2000);
        assertEq(uint256(p.fundedBuild), 0);
        assertTrue(p.titleHash == keccak256("GOLDEN_TOILET_TOWER"));
        assertEq(core.nextProjectId(), 2);
    }

    function test_GenesisProject_EventEmittedInConstructor() public {
        // covered in setUp expectEmit; re-deploy to assert explicitly
        RepublicCore core2 = new RepublicCore(address(registry));
        RepublicCore.Project memory p = core2.getProject(1);
        assertEq(uint256(p.goalBuild), 2000);
        assertEq(uint256(p.fundedBuild), 0);
    }

    // ---------------------------------------------------------- build balance

    function test_BuildBalance_100AfterRegistration() public view {
        assertEq(core.buildBalance(alice), 100);
    }

    function test_BuildBalance_ZeroForNonCitizen() public view {
        assertEq(core.buildBalance(eve), 0);
    }

    function test_BuildBalance_ZeroWhenIDLost_RestoredWithoutDoubleCounting() public {
        vm.prank(alice);
        agentId.burn(1); // alice loses her mock Agent ID
        assertEq(core.buildBalance(alice), 0);

        // re-acquiring the ID restores exactly 100 — the initial grant is
        // derived lazily and can never be double-counted
        vm.prank(alice);
        agentId.mint();
        assertEq(core.buildBalance(alice), 100);
    }

    // ------------------------------------------------------------- proposals

    function test_SubmitProposal_Success() public {
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.ProposalSubmitted(
            1, alice, PROPOSAL_HASH, uint64(block.timestamp), uint64(block.timestamp + 48 hours)
        );
        uint256 id = _submit(alice, PROPOSAL_HASH);

        assertEq(id, 1);
        assertEq(core.nextProposalId(), 2);

        RepublicCore.Proposal memory p = core.getProposal(1);
        assertEq(p.proposer, alice);
        assertTrue(p.contentHash == PROPOSAL_HASH);
        assertEq(uint256(p.endsAt - p.startsAt), 48 hours);
        assertEq(uint8(p.status), uint8(RepublicCore.ProposalStatus.OPEN));
    }

    function test_SubmitProposal_RevertWhen_NotCitizen() public {
        vm.prank(eve);
        vm.expectRevert(RepublicCore.NotCitizen.selector);
        core.submitProposal(PROPOSAL_HASH);
    }

    function test_SubmitProposal_RevertWhen_ContentHashZero() public {
        vm.prank(alice);
        vm.expectRevert(RepublicCore.InvalidContentHash.selector);
        core.submitProposal(bytes32(0));
    }

    function test_SubmitProposal_RevertWhen_SecondSameEpoch() public {
        _submit(alice, PROPOSAL_HASH);
        vm.prank(alice);
        vm.expectRevert(RepublicCore.TooManyProposals.selector);
        core.submitProposal(PROPOSAL_HASH_2);
    }

    function test_SubmitProposal_RevertWhen_EpochQuotaExceeded() public {
        _submit(alice, PROPOSAL_HASH);
        _submit(bob, PROPOSAL_HASH);
        _submit(carol, PROPOSAL_HASH);
        _submit(dave, PROPOSAL_HASH);
        _submit(erin, PROPOSAL_HASH);
        // 5th accepted => quota full

        vm.prank(gina);
        vm.expectRevert(RepublicCore.TooManyProposals.selector);
        core.submitProposal(PROPOSAL_HASH);
    }

    function test_SubmitProposal_QuotaResetsNextEpoch() public {
        _submit(alice, PROPOSAL_HASH);
        _submit(bob, PROPOSAL_HASH);
        _submit(carol, PROPOSAL_HASH);
        _submit(dave, PROPOSAL_HASH);
        _submit(erin, PROPOSAL_HASH);

        vm.warp(block.timestamp + 1 days); // next UTC epoch
        uint256 id = _submit(gina, PROPOSAL_HASH);
        assertEq(id, 6);
    }

    // ------------------------------------------------------------------ votes

    function test_CastVote_CountsAndRewards() public {
        uint256 id = _submit(alice, PROPOSAL_HASH);

        vm.expectEmit(true, true, true, true);
        emit RepublicCore.ReputationUpdated(alice, 2, keccak256("VOTE_REWARD"));
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.VoteCast(id, alice, 1);
        _vote(alice, id, 1); // YES, proposer may vote
        _vote(bob, id, 2); // NO
        _vote(carol, id, 3); // ABSTAIN

        RepublicCore.Proposal memory p = core.getProposal(id);
        assertEq(uint256(p.yesVotes), 1);
        assertEq(uint256(p.noVotes), 1);
        assertEq(uint256(p.abstainVotes), 1);

        // first effective vote of the epoch: +20 BUILD / +2 REP
        assertEq(core.buildBalance(alice), 120);
        assertEq(core.reputation(alice), 2);
        assertEq(core.reputation(bob), 2);
        assertEq(core.reputation(carol), 2);
    }

    function test_CastVote_RewardOnlyOncePerEpoch() public {
        uint256 id1 = _submit(alice, PROPOSAL_HASH);
        uint256 id2 = _submit(bob, PROPOSAL_HASH_2);

        _vote(alice, id1, 1);
        _vote(alice, id2, 1); // second vote same epoch: no extra reward

        assertEq(core.buildBalance(alice), 120);
        assertEq(core.reputation(alice), 2);
    }

    function test_CastVote_RewardAgainNextEpoch() public {
        uint256 id1 = _submit(alice, PROPOSAL_HASH);
        _vote(alice, id1, 1);

        vm.warp(block.timestamp + 1 days);
        uint256 id2 = _submit(bob, PROPOSAL_HASH_2);
        _vote(alice, id2, 1);

        assertEq(core.buildBalance(alice), 140);
        assertEq(core.reputation(alice), 4);
    }

    function test_CastVote_RevertWhen_AlreadyVoted() public {
        _submit(alice, PROPOSAL_HASH);
        _vote(alice, 1, 1);

        vm.prank(alice);
        vm.expectRevert(RepublicCore.AlreadyVoted.selector);
        core.castVote(1, 2);
    }

    function test_CastVote_RevertWhen_ChoiceNone() public {
        _submit(alice, PROPOSAL_HASH);
        vm.prank(bob);
        vm.expectRevert(RepublicCore.UnsupportedChoice.selector);
        core.castVote(1, 0);
    }

    function test_CastVote_RevertWhen_ChoiceInvalid() public {
        _submit(alice, PROPOSAL_HASH);
        vm.prank(bob);
        vm.expectRevert(RepublicCore.UnsupportedChoice.selector);
        core.castVote(1, 4);
    }

    function test_CastVote_RevertWhen_NotCitizen() public {
        _submit(alice, PROPOSAL_HASH);
        vm.prank(eve);
        vm.expectRevert(RepublicCore.NotCitizen.selector);
        core.castVote(1, 1);
    }

    function test_CastVote_RevertWhen_IDLost() public {
        _submit(alice, PROPOSAL_HASH);
        vm.prank(dave);
        agentId.burn(4); // dave's token id (4th minted)

        vm.prank(dave);
        vm.expectRevert(RepublicCore.NotCitizen.selector);
        core.castVote(1, 1);
    }

    function test_CastVote_RevertWhen_ProposalNotFound() public {
        vm.prank(alice);
        vm.expectRevert(RepublicCore.ProposalNotFound.selector);
        core.castVote(99, 1);
    }

    function test_CastVote_RevertWhen_VotingClosed() public {
        _submit(alice, PROPOSAL_HASH);
        vm.warp(block.timestamp + 48 hours); // == endsAt => closed

        vm.prank(bob);
        vm.expectRevert(RepublicCore.VotingClosed.selector);
        core.castVote(1, 1);
    }

    // ------------------------------------------------------------- finalization

    function test_Finalize_RevertWhen_TooEarly() public {
        _submit(alice, PROPOSAL_HASH);
        vm.prank(bob);
        vm.expectRevert(RepublicCore.ProposalNotFinalizable.selector);
        core.finalizeProposal(1);
    }

    function test_Finalize_RevertWhen_NotFound() public {
        vm.prank(bob);
        vm.expectRevert(RepublicCore.ProposalNotFound.selector);
        core.finalizeProposal(99);
    }

    function test_Finalize_RevertWhen_AlreadyFinalized() public {
        _submit(alice, PROPOSAL_HASH);
        vm.warp(block.timestamp + 48 hours);
        vm.prank(bob);
        core.finalizeProposal(1);

        vm.prank(bob);
        vm.expectRevert(RepublicCore.ProposalNotFinalizable.selector);
        core.finalizeProposal(1);
    }

    function test_Finalize_ExpiredWhenUnderQuorum() public {
        _submit(alice, PROPOSAL_HASH);
        _vote(alice, 1, 1);
        _vote(bob, 1, 1); // only 2 votes < quorum 3

        vm.warp(block.timestamp + 48 hours);
        vm.prank(eve); // anyone can finalize
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.ProposalFinalized(1, 4, 2, 0, 0); // EXPIRED = 4, 2 yes 0 no 0 abstain
        core.finalizeProposal(1);

        assertEq(uint8(core.getProposal(1).status), uint8(RepublicCore.ProposalStatus.EXPIRED));
    }

    function test_Finalize_PassedWhenYesMajority() public {
        _submit(alice, PROPOSAL_HASH);
        _vote(alice, 1, 1);
        _vote(bob, 1, 1);
        _vote(carol, 1, 2); // 2 yes vs 1 no

        vm.warp(block.timestamp + 48 hours);
        vm.prank(eve);
        core.finalizeProposal(1);

        assertEq(uint8(core.getProposal(1).status), uint8(RepublicCore.ProposalStatus.PASSED));
    }

    function test_Finalize_RejectedOnTie() public {
        _submit(alice, PROPOSAL_HASH);
        _vote(alice, 1, 1);
        _vote(bob, 1, 2);
        _vote(carol, 1, 3); // 1-1 tie, abstain breaks nothing => rejected

        vm.warp(block.timestamp + 48 hours);
        vm.prank(eve);
        core.finalizeProposal(1);

        assertEq(uint8(core.getProposal(1).status), uint8(RepublicCore.ProposalStatus.REJECTED));
    }

    function test_Finalize_AbstainQuorumStillCounts() public {
        _submit(alice, PROPOSAL_HASH);
        _vote(alice, 1, 3);
        _vote(bob, 1, 3);
        _vote(carol, 1, 3); // 3 abstains >= quorum, yes(0) !> no(0) => REJECTED

        vm.warp(block.timestamp + 48 hours);
        vm.prank(eve);
        core.finalizeProposal(1);

        assertEq(uint8(core.getProposal(1).status), uint8(RepublicCore.ProposalStatus.REJECTED));
    }

    // ------------------------------------------------------------ contributions

    function test_Contribute_Success() public {
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.ReputationUpdated(alice, 3, keccak256("CONTRIB_REWARD"));
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.ContributionMade(alice, 1, 30, 30);
        _contribute(alice, 30);

        RepublicCore.Project memory p = core.getProject(1);
        assertEq(uint256(p.fundedBuild), 30);
        assertEq(core.buildBalance(alice), 70); // 100 - 30
        assertEq(core.contributedToProject(1, alice), 30);
        assertEq(core.reputation(alice), 3); // 30 / 10
    }

    function test_Contribute_RevertWhen_NotCitizen() public {
        vm.prank(eve);
        vm.expectRevert(RepublicCore.NotCitizen.selector);
        core.contribute(1, 10);
    }

    function test_Contribute_RevertWhen_ZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(RepublicCore.InvalidAmount.selector);
        core.contribute(1, 0);
    }

    function test_Contribute_RevertWhen_InsufficientBuild() public {
        vm.prank(alice);
        vm.expectRevert(RepublicCore.InsufficientBuild.selector);
        core.contribute(1, 101); // balance is exactly 100
    }

    function test_Contribute_RevertWhen_ExceedsGoal() public {
        // fund 1900 via 19 citizens so only 100 remains toward the 2000 goal
        for (uint256 i = 0; i < 19; i++) {
            address c = makeAddr(string.concat("filler-", vm.toString(i)));
            _mintAndRegister(c, keccak256(abi.encodePacked("f-", c)));
            _contribute(c, 100);
        }
        // bob votes first (+20 => 120 balance) so 101 passes the balance
        // check and must be rejected specifically for exceeding the goal
        uint256 id = _submit(carol, PROPOSAL_HASH);
        _vote(bob, id, 1);

        vm.prank(bob);
        vm.expectRevert(RepublicCore.ExceedsProjectGoal.selector);
        core.contribute(1, 101); // remaining is 100
    }

    function test_Contribute_RevertWhen_ProjectNotFound() public {
        vm.prank(alice);
        vm.expectRevert(RepublicCore.ProjectNotFound.selector);
        core.contribute(99, 10);
    }

    function test_Contribute_SplitRepFairness() public {
        // alice: 5 x 10 BUILD in separate txs
        for (uint256 i = 0; i < 5; i++) {
            _contribute(alice, 10);
        }
        // bob: one 50 BUILD tx
        _contribute(bob, 50);

        // split contributions must not earn more REP than a single one
        assertEq(core.reputation(alice), 5);
        assertEq(core.reputation(bob), 5);
        assertEq(core.buildBalance(alice), 50);
        assertEq(core.buildBalance(bob), 50);
    }

    function test_Contribute_DailyRepCap() public {
        // alice burns her whole 100 => exactly 10 REP (cap boundary)
        _contribute(alice, 100);
        assertEq(core.reputation(alice), 10);

        // bob votes (+20 BUILD, +2 REP) then contributes 120: floor(120/10)=12
        // would be 12 contribution-REP but the daily cap limits it to 10,
        // so total reputation = 2 (vote) + 10 (capped contribution) = 12
        uint256 id = _submit(carol, PROPOSAL_HASH);
        _vote(bob, id, 1);
        _contribute(bob, 120);
        assertEq(core.reputation(bob), 12);
    }

    function test_Contribute_RepResumesNextEpoch() public {
        _contribute(alice, 100); // day 1: rep 10 (capped)
        assertEq(core.reputation(alice), 10);

        vm.warp(block.timestamp + 1 days); // day 2
        uint256 id = _submit(carol, PROPOSAL_HASH);
        _vote(alice, id, 1); // +20 BUILD / +2 REP
        _contribute(alice, 20); // day-2 contribution 20 => +2 REP
        assertEq(core.reputation(alice), 14); // 10 + 2 (vote) + 2
    }

    function test_Contribute_CompletesGenesisExactlyOnce() public {
        // 19 citizens x 100 = 1900 (need 20 total incl. alice)
        for (uint256 i = 0; i < 19; i++) {
            address c = makeAddr(string.concat("builder-", vm.toString(i)));
            _mintAndRegister(c, keccak256(abi.encodePacked("c-", c)));
            _contribute(c, 100);
        }
        RepublicCore.Project memory p = core.getProject(1);
        assertEq(uint256(p.fundedBuild), 1900);
        assertEq(uint8(p.status), uint8(RepublicCore.ProjectStatus.FUNDING));

        // the final 100 completes the goal exactly
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.ProjectCompleted(1, uint64(block.timestamp));
        _contribute(alice, 100);

        p = core.getProject(1);
        assertEq(uint256(p.fundedBuild), 2000);
        assertEq(uint8(p.status), uint8(RepublicCore.ProjectStatus.COMPLETED));

        // post-completion contributions are rejected — the completion event
        // can never fire twice
        vm.prank(bob);
        vm.expectRevert(RepublicCore.FundingClosed.selector);
        core.contribute(1, 10);
    }

    // ------------------------------------------------------------------- NOTEs

    function test_PublishNote_ByOwner() public {
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.NotePublished(alice, alice, NOTE_HASH, uint64(block.timestamp / 1 days));
        vm.prank(alice);
        core.publishNote(alice, NOTE_HASH);

        assertEq(core.noteCountInEpoch(uint64(block.timestamp / 1 days), alice), 1);
    }

    function test_PublishNote_ByDelegate() public {
        vm.expectEmit(true, true, true, true);
        emit RepublicCore.NotePublished(alice, frank, NOTE_HASH, uint64(block.timestamp / 1 days));
        vm.prank(frank);
        core.publishNote(alice, NOTE_HASH);
    }

    function test_PublishNote_RevertWhen_UnauthorizedActor() public {
        vm.prank(bob); // another citizen is NOT alice's delegate
        vm.expectRevert(RepublicCore.UnauthorizedNoteActor.selector);
        core.publishNote(alice, NOTE_HASH);

        vm.prank(eve);
        vm.expectRevert(RepublicCore.UnauthorizedNoteActor.selector);
        core.publishNote(alice, NOTE_HASH);
    }

    function test_PublishNote_RevertWhen_HashZero() public {
        vm.prank(alice);
        vm.expectRevert(RepublicCore.InvalidContentHash.selector);
        core.publishNote(alice, bytes32(0));
    }

    function test_PublishNote_RevertWhen_OwnerNotCitizen() public {
        vm.prank(frank);
        vm.expectRevert(RepublicCore.UnauthorizedNoteActor.selector);
        core.publishNote(eve, NOTE_HASH);
    }

    function test_PublishNote_RevertWhen_OwnerPathNotCitizen() public {
        vm.prank(eve);
        vm.expectRevert(RepublicCore.NotCitizen.selector);
        core.publishNote(eve, NOTE_HASH);
    }

    function test_PublishNote_RevertWhen_HardQuotaExceeded() public {
        vm.startPrank(alice);
        core.publishNote(alice, keccak256("n1"));
        core.publishNote(alice, keccak256("n2"));
        core.publishNote(alice, keccak256("n3"));
        vm.expectRevert(RepublicCore.NoteQuotaExceeded.selector);
        core.publishNote(alice, keccak256("n4"));
        vm.stopPrank();
    }

    function test_PublishNote_RevertWhen_DelegateCustomLimit() public {
        // alice's delegation caps frank at 2 notes per epoch
        vm.startPrank(frank);
        core.publishNote(alice, keccak256("n1"));
        core.publishNote(alice, keccak256("n2"));
        vm.expectRevert(RepublicCore.NoteQuotaExceeded.selector);
        core.publishNote(alice, keccak256("n3"));
        vm.stopPrank();

        // the owner herself can still publish up to the hard cap of 3
        vm.prank(alice);
        core.publishNote(alice, keccak256("n3"));
    }

    function test_PublishNote_QuotaResetsNextEpoch() public {
        vm.startPrank(alice);
        core.publishNote(alice, keccak256("n1"));
        core.publishNote(alice, keccak256("n2"));
        core.publishNote(alice, keccak256("n3"));
        vm.stopPrank();

        vm.warp(block.timestamp + 1 days);
        vm.prank(alice);
        core.publishNote(alice, keccak256("n4")); // new epoch => allowed
    }

    function test_PublishNote_NoEconomicEffect() public {
        uint256 buildBefore = core.buildBalance(alice);
        uint256 repBefore = core.reputation(alice);
        vm.prank(alice);
        core.publishNote(alice, NOTE_HASH);
        assertEq(core.buildBalance(alice), buildBefore);
        assertEq(core.reputation(alice), repBefore);
    }

    // ------------------------------------------------------ security matrix

    function test_DelegateCannotVoteOrContribute() public {
        uint256 id = _submit(alice, PROPOSAL_HASH);

        // frank is alice's NOTE delegate but holds no Agent ID himself:
        // he cannot vote or contribute — not even "for" alice
        vm.prank(frank);
        vm.expectRevert(RepublicCore.NotCitizen.selector);
        core.castVote(id, 1);

        vm.prank(frank);
        vm.expectRevert(RepublicCore.NotCitizen.selector);
        core.contribute(1, 10);
    }

    function test_RevokedDelegateCannotPublishNotes() public {
        vm.prank(alice);
        registry.revokeDelegate();

        vm.prank(frank);
        vm.expectRevert(RepublicCore.UnauthorizedNoteActor.selector);
        core.publishNote(alice, NOTE_HASH);
    }

    function test_GetCitizenState() public view {
        (uint256 build, uint256 rep, bool registered) = core.getCitizenState(alice);
        assertEq(build, 100);
        assertEq(rep, 0);
        assertTrue(registered);

        (build, rep, registered) = core.getCitizenState(eve);
        assertEq(build, 0);
        assertEq(rep, 0);
        assertFalse(registered);
    }
}
