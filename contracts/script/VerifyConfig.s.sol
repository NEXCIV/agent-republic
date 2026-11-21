// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {RepublicRegistry} from "../src/RepublicRegistry.sol";
import {RepublicCore} from "../src/RepublicCore.sol";

/// @notice Post-deployment configuration verifier for CI / release checks.
/// Reads AGENT_ID_ADDRESS, REGISTRY_ADDRESS, CORE_ADDRESS from the
/// environment and re-checks the wiring against the immutable rules:
///   - on mainnet (56) the Registry must reference the official Agent ID
///     0x60b9262456de011f7d15a54cdd8c48baaa8b022f;
///   - Core must point back at the Registry;
///   - genesis project #1: GOLDEN_TOILET_TOWER, goal 2000, funded 0, FUNDING.
/// Exits with a revert on any mismatch (fail closed).
/// Usage:
///   AGENT_ID_ADDRESS=.. REGISTRY_ADDRESS=.. CORE_ADDRESS=.. \
///   forge script script/VerifyConfig.s.sol --rpc-url $RPC
contract VerifyConfig is Script {
    address public constant OFFICIAL_AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    error VerificationFailed(string reason);

    function run() public view {
        uint256 chainId = block.chainid;
        if (chainId != 56 && chainId != 97) {
            revert VerificationFailed("unsupported chain: expected 56 or 97");
        }

        address agentId = vm.envAddress("AGENT_ID_ADDRESS");
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");
        address coreAddr = vm.envAddress("CORE_ADDRESS");

        if (chainId == 56 && agentId != OFFICIAL_AGENT_ID) {
            revert VerificationFailed("mainnet Agent ID address is not the official contract");
        }

        RepublicRegistry registry = RepublicRegistry(registryAddr);
        RepublicCore core = RepublicCore(coreAddr);

        if (address(registry.agentId()) != agentId) {
            revert VerificationFailed("registry.agentId mismatch");
        }
        if (address(core.registry()) != registryAddr) {
            revert VerificationFailed("core.registry mismatch");
        }
        if (agentId.code.length == 0) {
            revert VerificationFailed("no code at Agent ID address");
        }

        RepublicCore.Project memory p = core.getProject(1);
        if (p.titleHash != keccak256("GOLDEN_TOILET_TOWER")) {
            revert VerificationFailed("genesis titleHash mismatch");
        }
        if (p.goalBuild != 2000) {
            revert VerificationFailed("genesis goalBuild mismatch");
        }
        if (p.fundedBuild != 0) {
            revert VerificationFailed("genesis fundedBuild must start at 0");
        }
        if (p.status != RepublicCore.ProjectStatus.FUNDING) {
            revert VerificationFailed("genesis status must be FUNDING");
        }

        console.log("VerifyConfig: OK (chainId %s)", vm.toString(chainId));
    }
}
