// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";

import {Deploy} from "../script/Deploy.s.sol";

/// @notice Guard tests for the deployment script (SMART_CONTRACTS.md §8):
/// deploying on any chain other than 56/97 must fail closed.
contract ScriptTest is Test {
    function test_Deploy_RevertWhen_UnsupportedChain() public {
        Deploy deploy = new Deploy();
        // local test chain id is 31337
        vm.expectRevert(abi.encodeWithSelector(Deploy.UnsupportedChain.selector, 31337));
        deploy.run();
    }
}
