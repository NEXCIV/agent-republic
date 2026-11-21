// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Read-only view into the official Binance Agent ID ERC-721 contract
///         on BSC Mainnet (0x60b9262456de011f7d15a54cdd8c48baaa8b022f).
///         Citizenship eligibility is balanceOf(owner) > 0.
///         This project never mints, transfers or holds Agent IDs.
interface IAgentID {
    function balanceOf(address owner) external view returns (uint256);
}
