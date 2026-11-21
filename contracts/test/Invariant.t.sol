// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";

import {MockAgentID} from "../src/MockAgentID.sol";
import {RepublicRegistry} from "../src/RepublicRegistry.sol";
import {RepublicCore} from "../src/RepublicCore.sol";

/// @notice Invariant/fuzz tests for RepublicCore (SMART_CONTRACTS.md §6-§7).
/// A bounded handler runs random operation sequences from a pool of actors;
/// ghost totals are updated only on successful calls. Invariants:
///   I1  fundedBuild <= goalBuild (and matches the ghost ledger)
///   I2  BUILD conservation: sum(balances) + spent == 100*registered + 20*rewardedVotes
///   I3  REP is fully explainable by history (2 per rewarded vote + contribution REP)
///   I4  per-proposal counters equal the number of accepted votes
///   I5  COMPLETED implies fundedBuild == goalBuild
contract Handler is Test {
    MockAgentID public agentId;
    RepublicRegistry public registry;
    RepublicCore public core;

    address[] public actors;

    // ghost state (only updated on success)
    uint256 public registeredCount;
    uint256 public totalVoteRewards; // sum of +20 BUILD grants
    uint256 public totalSpent; // sum of accepted contributions
    uint256 public ghostRepTotal; // sum of all REP ever granted
    uint256 public ghostFunded; // mirrors project 1 fundedBuild
    mapping(uint256 => uint256) public ghostProposalVotes;

    constructor(MockAgentID agentId_, RepublicRegistry registry_, RepublicCore core_) {
        agentId = agentId_;
        registry = registry_;
        core = core_;
        for (uint256 i = 0; i < 8; i++) {
            actors.push(makeAddr(string.concat("actor-", vm.toString(i))));
        }
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    // ------------------------------------------------------------ operations

    function register(uint256 actorSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (registry.registered(actor)) return;
        if (agentId.balanceOf(actor) == 0) {
            vm.prank(actor);
            agentId.mint();
        }
        vm.prank(actor);
        try registry.registerCitizen(keccak256(abi.encodePacked("c", actor))) {
            registeredCount += 1;
        } catch {}
    }

    function submitProposal(uint256 actorSeed, uint256 hashSeed) external {
        address actor = actors[actorSeed % actors.length];
        bytes32 contentHash = bytes32(bound(hashSeed, 1, type(uint128).max));
        vm.prank(actor);
        try core.submitProposal(contentHash) {
            ghostProposalVotes[core.nextProposalId() - 1] = 0;
        } catch {}
    }

    function castVote(uint256 actorSeed, uint256 propSeed, uint256 choiceSeed) external {
        address actor = actors[actorSeed % actors.length];
        if (core.nextProposalId() <= 1) return;
        uint256 propId = bound(propSeed, 1, core.nextProposalId() - 1);
        uint8 choice = uint8(bound(choiceSeed, 0, 4));

        uint256 balBefore = core.buildBalance(actor);
        uint256 repBefore = core.reputation(actor);
        vm.prank(actor);
        try core.castVote(propId, choice) {
            totalVoteRewards += core.buildBalance(actor) - balBefore;
            ghostRepTotal += core.reputation(actor) - repBefore;
            ghostProposalVotes[propId] += 1;
        } catch {}
    }

    function finalizeProposal(uint256 propSeed) external {
        if (core.nextProposalId() <= 1) return;
        uint256 propId = bound(propSeed, 1, core.nextProposalId() - 1);
        vm.prank(actors[propSeed % actors.length]);
        try core.finalizeProposal(propId) {} catch {}
    }

    function contribute(uint256 actorSeed, uint256 amountSeed) external {
        address actor = actors[actorSeed % actors.length];
        uint128 amount = uint128(bound(amountSeed, 0, 150));

        uint256 repBefore = core.reputation(actor);
        vm.prank(actor);
        try core.contribute(1, amount) {
            totalSpent += amount;
            ghostRepTotal += core.reputation(actor) - repBefore;
            ghostFunded = core.getProject(1).fundedBuild;
        } catch {}
    }

    function publishNote(uint256 actorSeed, uint256 ownerSeed, uint256 hashSeed) external {
        address actor = actors[actorSeed % actors.length];
        address owner = actors[ownerSeed % actors.length];
        bytes32 noteHash = bytes32(bound(hashSeed, 1, type(uint128).max));
        vm.prank(actor);
        try core.publishNote(owner, noteHash) {} catch {}
    }

    /// @dev Advance time randomly across epoch boundaries.
    function warp(uint256 timeSeed) external {
        vm.warp(block.timestamp + bound(timeSeed, 0, 2 days));
    }
}

contract InvariantTest is StdInvariant, Test {
    Handler internal handler;
    MockAgentID internal agentId;
    RepublicRegistry internal registry;
    RepublicCore internal core;

    function setUp() public {
        agentId = new MockAgentID();
        registry = new RepublicRegistry(address(agentId));
        core = new RepublicCore(address(registry));
        handler = new Handler(agentId, registry, core);

        targetContract(address(handler));
    }

    /// I1: funded never exceeds the 2000 goal and matches accepted contributions.
    function invariant_FundedWithinGoal() public view {
        RepublicCore.Project memory p = core.getProject(1);
        assertLe(uint256(p.fundedBuild), uint256(p.goalBuild));
        assertEq(uint256(p.fundedBuild), handler.ghostFunded());
    }

    /// I2: BUILD ledger conservation.
    function invariant_BuildLedgerConservation() public view {
        uint256 sumBalances = 0;
        for (uint256 i = 0; i < handler.actorsLength(); i++) {
            sumBalances += core.buildBalance(handler.actors(i));
        }
        assertEq(sumBalances + handler.totalSpent(), 100 * handler.registeredCount() + handler.totalVoteRewards());
    }

    /// I3: REP is fully explainable by recorded history.
    function invariant_RepMatchesHistory() public view {
        uint256 sumRep = 0;
        for (uint256 i = 0; i < handler.actorsLength(); i++) {
            sumRep += core.reputation(handler.actors(i));
        }
        assertEq(sumRep, handler.ghostRepTotal());
    }

    /// I4: proposal counters equal accepted votes.
    function invariant_VoteCountsMatch() public view {
        for (uint256 id = 1; id < core.nextProposalId(); id++) {
            RepublicCore.Proposal memory p = core.getProposal(id);
            assertEq(uint256(p.yesVotes) + uint256(p.noVotes) + uint256(p.abstainVotes), handler.ghostProposalVotes(id));
        }
    }

    /// I5: completion implies fully funded (never over).
    function invariant_CompletedImpliesFundedEqualsGoal() public view {
        RepublicCore.Project memory p = core.getProject(1);
        if (p.status == RepublicCore.ProjectStatus.COMPLETED) {
            assertEq(uint256(p.fundedBuild), uint256(p.goalBuild));
        }
    }
}
