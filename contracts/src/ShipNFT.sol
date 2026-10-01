// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {ERC721Enumerable} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721Enumerable.sol";
import {ERC721URIStorage} from "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ShipNFT
 * @notice Owns ROCKET RIFT: FRONTIER ships. A ship is a *playstyle* asset, never a
 *         power gate: every ship minted here is also obtainable in-game through
 *         progression. On-chain ownership only adds transferability + provenance.
 *
 *  - Stats live on-chain so marketplaces can display them trustlessly.
 *  - Minting is gated to an authorized minter (the game server) OR a signed voucher,
 *    so players never expose a private key to the game.
 *  - Ships are non-transferable while "locked" (equipped in an active session).
 */
contract ShipNFT is ERC721, ERC721Enumerable, ERC721URIStorage, Ownable, EIP712 {
    struct ShipStats {
        uint16 health;
        uint16 shield;
        uint16 damage;
        uint16 speed;      // x100 (700 = 7.00)
        uint16 fireRate;   // x100 (100 = 1.00)
        uint16 critChance; // bps  (500 = 5.00%)
        uint16 cargo;
    }

    struct ShipData {
        string shipKey;    // e.g. "raptor_x"
        uint8 rarity;      // 0..5 -> COMMON..MYTHIC
        uint16 level;
        ShipStats stats;
        bool locked;       // true while equipped in a live session
    }

    bytes32 private constant MINT_VOUCHER_TYPEHASH =
        keccak256(
            "MintVoucher(address to,string shipKey,uint8 rarity,uint16 level,uint16 health,uint16 shield,uint16 damage,uint16 speed,uint16 fireRate,uint16 critChance,uint16 cargo,string uri,uint256 nonce,uint256 deadline)"
        );

    uint256 private _nextTokenId = 1;
    uint256 public maxSupply = 100_000;

    mapping(uint256 => ShipData) private _ships;
    mapping(address => bool) public minters;
    mapping(uint256 => bool) public voucherUsed;

    string public baseTokenURI;

    event ShipMinted(uint256 indexed tokenId, address indexed to, string shipKey, uint8 rarity);
    event ShipLocked(uint256 indexed tokenId);
    event ShipUnlocked(uint256 indexed tokenId);
    event MinterUpdated(address indexed minter, bool allowed);
    event BaseURIUpdated(string newBaseURI);

    error NotMinter();
    error MaxSupplyReached();
    error ShipIsLocked(uint256 tokenId);
    error VoucherExpired();
    error VoucherAlreadyUsed();
    error InvalidSignature();
    error UnknownToken(uint256 tokenId);

    modifier onlyMinter() {
        if (!minters[msg.sender] && msg.sender != owner()) revert NotMinter();
        _;
    }

    constructor(string memory name_, string memory symbol_, string memory baseURI_)
        ERC721(name_, symbol_)
        Ownable(msg.sender)
        EIP712("RocketRiftShip", "1")
    {
        baseTokenURI = baseURI_;
        minters[msg.sender] = true;
    }

    function setMinter(address minter, bool allowed) external onlyOwner {
        minters[minter] = allowed;
        emit MinterUpdated(minter, allowed);
    }

    function setBaseURI(string calldata newBaseURI) external onlyOwner {
        baseTokenURI = newBaseURI;
        emit BaseURIUpdated(newBaseURI);
    }

    function setMaxSupply(uint256 newMax) external onlyOwner {
        require(newMax >= _nextTokenId - 1, "below minted");
        maxSupply = newMax;
    }

    /// @notice Server-side mint (game rewards, marketplace settlement).
    function mint(
        address to,
        string calldata shipKey,
        uint8 rarity,
        uint16 level,
        ShipStats calldata stats,
        string calldata uri
    ) external onlyMinter returns (uint256 tokenId) {
        tokenId = _mintShip(to, shipKey, rarity, level, stats, uri);
    }

    /// @notice Player-facing mint from a server-signed voucher. The player pays gas;
    ///         the server never holds the player's key.
    function mintWithVoucher(
        address to,
        string calldata shipKey,
        uint8 rarity,
        uint16 level,
        ShipStats calldata stats,
        string calldata uri,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external returns (uint256 tokenId) {
        if (block.timestamp > deadline) revert VoucherExpired();
        if (voucherUsed[nonce]) revert VoucherAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(
                MINT_VOUCHER_TYPEHASH,
                to,
                keccak256(bytes(shipKey)),
                rarity,
                level,
                stats.health,
                stats.shield,
                stats.damage,
                stats.speed,
                stats.fireRate,
                stats.critChance,
                stats.cargo,
                keccak256(bytes(uri)),
                nonce,
                deadline
            )
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address signer = ECDSA.recover(digest, signature);
        if (!minters[signer] && signer != owner()) revert InvalidSignature();

        voucherUsed[nonce] = true;
        tokenId = _mintShip(to, shipKey, rarity, level, stats, uri);
    }

    function _mintShip(
        address to,
        string calldata shipKey,
        uint8 rarity,
        uint16 level,
        ShipStats calldata stats,
        string calldata uri
    ) private returns (uint256 tokenId) {
        if (_nextTokenId > maxSupply) revert MaxSupplyReached();
        tokenId = _nextTokenId++;
        _ships[tokenId] = ShipData({shipKey: shipKey, rarity: rarity, level: level, stats: stats, locked: false});
        _safeMint(to, tokenId);
        _setTokenURI(tokenId, uri);
        emit ShipMinted(tokenId, to, shipKey, rarity);
    }

    function lock(uint256 tokenId) external onlyMinter {
        _requireOwned(tokenId);
        _ships[tokenId].locked = true;
        emit ShipLocked(tokenId);
    }

    function unlock(uint256 tokenId) external onlyMinter {
        _requireOwned(tokenId);
        _ships[tokenId].locked = false;
        emit ShipUnlocked(tokenId);
    }

    function getShip(uint256 tokenId) external view returns (ShipData memory) {
        if (_ownerOf(tokenId) == address(0)) revert UnknownToken(tokenId);
        return _ships[tokenId];
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }

    function tokenURI(uint256 tokenId) public view override(ERC721, ERC721URIStorage) returns (string memory) {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, ERC721Enumerable, ERC721URIStorage)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    function _update(address to, uint256 tokenId, address auth)
        internal
        override(ERC721, ERC721Enumerable)
        returns (address)
    {
        if (_ships[tokenId].locked) revert ShipIsLocked(tokenId);
        return super._update(to, tokenId, auth);
    }

    function _increaseBalance(address account, uint128 value) internal override(ERC721, ERC721Enumerable) {
        super._increaseBalance(account, value);
    }

    function _baseURI() internal view override returns (string memory) {
        return baseTokenURI;
    }
}
