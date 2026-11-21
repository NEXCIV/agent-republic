// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";

import {IAgentID} from "../src/IAgentID.sol";
import {MockAgentID} from "../src/MockAgentID.sol";
import {RepublicRegistry} from "../src/RepublicRegistry.sol";
import {RepublicCore} from "../src/RepublicCore.sol";

/// @notice One-shot deployment script.
/// - BSC Mainnet (chainId 56): Registry must point at the official Agent ID
///   contract from the hackathon announcement. Fails otherwise.
/// - BSC Testnet (chainId 97): deploys MockAgentID first (testnet stand-in).
/// - Any other chain: refuses to deploy.
/// After deployment it re-checks the wiring and writes deployments/<id>.json.
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast
contract Deploy is Script {
    /// @dev Official Binance Agent ID ERC-721 on BSC Mainnet. NEVER change.
    address public constant OFFICIAL_AGENT_ID = 0x60B9262456dE011F7d15a54CdD8c48bAaa8B022F;

    uint256 public constant EXPECTED_CHAIN_ID_MAINNET = 56;
    uint256 public constant EXPECTED_CHAIN_ID_TESTNET = 97;

    error UnsupportedChain(uint256 chainId);
    error PostDeployVerificationFailed();

    function run() public returns (RepublicRegistry registry, RepublicCore core) {
        uint256 chainId = block.chainid;

        vm.startBroadcast();

        address agentId;
        if (chainId == EXPECTED_CHAIN_ID_MAINNET) {
            agentId = OFFICIAL_AGENT_ID;
        } else if (chainId == EXPECTED_CHAIN_ID_TESTNET) {
            MockAgentID mock = new MockAgentID();
            agentId = address(mock);
        } else {
            revert UnsupportedChain(chainId);
        }

        registry = new RepublicRegistry(agentId);
        core = new RepublicCore(address(registry));

        vm.stopBroadcast();

        // Post-deploy verification: fail loudly instead of shipping bad wiring.
        if (!_verify(chainId, agentId, address(registry), address(core))) {
            revert PostDeployVerificationFailed();
        }

        string memory obj = "deployment";
        vm.serializeString(obj, "chainId", vm.toString(chainId));
        vm.serializeString(obj, "network", chainId == 56 ? "BSC Mainnet" : "BSC Testnet");
        vm.serializeString(obj, "agentId", vm.toString(agentId));
        vm.serializeString(obj, "registry", vm.toString(address(registry)));
        vm.serializeString(obj, "core", vm.toString(address(core)));
        vm.serializeString(obj, "deployedAtBlock", vm.toString(block.number));
        string memory json = vm.serializeBool(obj, "verified", true);
        vm.writeJson(json, string.concat("./deployments/", vm.toString(chainId), ".json"));

        console.log("Registry:", address(registry));
        console.log("Core:    ", address(core));
        console.log("AgentID: ", agentId);
    }

    /// @dev Internal wiring + genesis checks, shared with VerifyConfig.s.sol.
    function _verify(uint256 chainId, address agentId, address registryAddr, address coreAddr)
        internal
        view
        returns (bool)
    {
        if (chainId == EXPECTED_CHAIN_ID_MAINNET && agentId != OFFICIAL_AGENT_ID) return false;

        RepublicRegistry registry = RepublicRegistry(registryAddr);
        RepublicCore core = RepublicCore(coreAddr);

        if (address(registry.agentId()) != agentId) return false;
        if (address(core.registry()) != registryAddr) return false;
        if (agentId.code.length == 0) return false;

        RepublicCore.Project memory p = core.getProject(1);
        if (p.titleHash != keccak256("GOLDEN_TOILET_TOWER")) return false;
        if (p.goalBuild != 2000) return false;
        if (p.fundedBuild != 0) return false;
        if (p.status != RepublicCore.ProjectStatus.FUNDING) return false;

        return true;
    }
}
