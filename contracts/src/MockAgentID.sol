// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MockAgentID — TESTNET / TEST-ONLY stand-in for the official
///        Binance Agent ID ERC-721 contract.
/// @dev NEVER deploy this on BSC Mainnet. On mainnet the Registry must point
///      at the official contract 0x60b9262456de011f7d15a54cdd8c48baaa8b022f.
///      This mock implements only the surface RepublicRegistry depends on
///      (`balanceOf`) plus test-friendly mint/burn so tests and testnet users
///      can simulate acquiring or losing an Agent ID. It intentionally does
///      NOT implement transfers, approvals or full ERC-721 semantics beyond
///      a minimal Transfer event for wallet visibility.
contract MockAgentID {
    string public constant NAME = "Mock Agent ID (TESTNET ONLY)";

    uint256 private _nextTokenId = 1;
    mapping(uint256 => address) private _owners;
    mapping(address => uint256) private _balances;

    event Transfer(address indexed from, address indexed to, uint256 indexed tokenId);

    error ZeroAddress();
    error NotTokenOwner();
    error NonexistentToken();

    /// @notice Mint one mock Agent ID to the caller.
    function mint() external returns (uint256 tokenId) {
        tokenId = _nextTokenId++;
        _owners[tokenId] = msg.sender;
        _balances[msg.sender] += 1;
        emit Transfer(address(0), msg.sender, tokenId);
    }

    /// @notice Burn a mock Agent ID owned by the caller (simulate ID loss).
    function burn(uint256 tokenId) external {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken();
        if (tokenOwner != msg.sender) revert NotTokenOwner();
        delete _owners[tokenId];
        _balances[msg.sender] -= 1;
        emit Transfer(msg.sender, address(0), tokenId);
    }

    /// @notice Same semantics as ERC-721 balanceOf: > 0 means eligible.
    function balanceOf(address owner) external view returns (uint256) {
        if (owner == address(0)) revert ZeroAddress();
        return _balances[owner];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address tokenOwner = _owners[tokenId];
        if (tokenOwner == address(0)) revert NonexistentToken();
        return tokenOwner;
    }
}
