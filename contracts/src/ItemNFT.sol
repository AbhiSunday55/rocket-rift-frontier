// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title ItemNFT
 * @notice ERC-1155 for stackable RIFT assets: weapons, skins, equipment,
 *         collectibles and accessories.
 *
 * Category map (mirrors the off-chain `item_category` enum):
 *   0 SHIP (reserved — ships live in ShipNFT)
 *   1 WEAPON
 *   2 SKIN
 *   3 EQUIPMENT
 *   4 COLLECTIBLE
 *   5 ACCESSORY
 *
 * Rarity map: 0 COMMON .. 5 MYTHIC
 *
 * IMPORTANT: nothing minted here is required to play. Cosmetics and sidegrades
 * only — the free-to-play loop never depends on this contract.
 */
contract ItemNFT is ERC1155, ERC1155Supply, Ownable {
    using Strings for uint256;

    struct ItemType {
        string itemKey;
        uint8 category;
        uint8 rarity;
        uint16 maxSupply;   // 0 = unlimited
        bool soulbound;     // true for achievement collectibles
        bool tradeable;
    }

    uint256 private _nextTypeId = 1;
    string public baseTokenURI;

    mapping(uint256 => ItemType) private _types;
    mapping(address => bool) public minters;

    event ItemTypeCreated(uint256 indexed typeId, string itemKey, uint8 category, uint8 rarity);
    event ItemMinted(uint256 indexed typeId, address indexed to, uint256 amount);
    event MinterUpdated(address indexed minter, bool allowed);
    event BaseURIUpdated(string newBaseURI);

    error NotMinter();
    error UnknownType(uint256 typeId);
    error MaxSupplyExceeded(uint256 typeId);
    error NotTradeable(uint256 typeId);
    error Soulbound();

    modifier onlyMinter() {
        if (!minters[msg.sender] && msg.sender != owner()) revert NotMinter();
        _;
    }

    constructor(string memory baseURI_) ERC1155(baseURI_) Ownable(msg.sender) {
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

    function createItemType(
        string calldata itemKey,
        uint8 category,
        uint8 rarity,
        uint16 maxSupply,
        bool soulbound,
        bool tradeable
    ) external onlyOwner returns (uint256 typeId) {
        typeId = _nextTypeId++;
        _types[typeId] = ItemType({
            itemKey: itemKey,
            category: category,
            rarity: rarity,
            maxSupply: maxSupply,
            soulbound: soulbound,
            tradeable: tradeable
        });
        emit ItemTypeCreated(typeId, itemKey, category, rarity);
    }

    function mint(address to, uint256 typeId, uint256 amount, bytes calldata data) external onlyMinter {
        ItemType memory t = _types[typeId];
        if (bytes(t.itemKey).length == 0) revert UnknownType(typeId);
        if (t.maxSupply != 0 && totalSupply(typeId) + amount > t.maxSupply) revert MaxSupplyExceeded(typeId);
        _mint(to, typeId, amount, data);
        emit ItemMinted(typeId, to, amount);
    }

    function mintBatch(address to, uint256[] calldata typeIds, uint256[] calldata amounts, bytes calldata data)
        external
        onlyMinter
    {
        for (uint256 i = 0; i < typeIds.length; i++) {
            ItemType memory t = _types[typeIds[i]];
            if (bytes(t.itemKey).length == 0) revert UnknownType(typeIds[i]);
            if (t.maxSupply != 0 && totalSupply(typeIds[i]) + amounts[i] > t.maxSupply) {
                revert MaxSupplyExceeded(typeIds[i]);
            }
        }
        _mintBatch(to, typeIds, amounts, data);
    }

    function burn(address from, uint256 typeId, uint256 amount) external onlyMinter {
        _burn(from, typeId, amount);
    }

    function getItemType(uint256 typeId) external view returns (ItemType memory) {
        return _types[typeId];
    }

    function totalTypes() external view returns (uint256) {
        return _nextTypeId - 1;
    }

    function uri(uint256 typeId) public view override returns (string memory) {
        return string.concat(baseTokenURI, typeId.toString(), ".json");
    }

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        // Allow mint (from == 0) and burn (to == 0); guard real transfers.
        if (from != address(0) && to != address(0)) {
            for (uint256 i = 0; i < ids.length; i++) {
                ItemType memory t = _types[ids[i]];
                if (t.soulbound) revert Soulbound();
                if (!t.tradeable) revert NotTradeable(ids[i]);
            }
        }
        super._update(from, to, ids, values);
    }
}
