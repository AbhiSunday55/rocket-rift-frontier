// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title Marketplace
 * @notice Escrow marketplace for ROCKET RIFT ships (ERC-721) and items (ERC-1155).
 *
 *  - Sellers escrow the asset in this contract when listing (no approvals needed at buy time).
 *  - Buyers pay in native currency or any allow-listed ERC-20.
 *  - A protocol fee in basis points is taken on settlement and sent to the treasury.
 *  - All state-changing entry points are ReentrancyGuard-protected and follow
 *    checks-effects-interactions.
 */
contract Marketplace is ReentrancyGuard, Ownable {
    using SafeERC20 for IERC20;

    enum AssetKind { ERC721, ERC1155 }

    struct Listing {
        address seller;
        address assetContract;
        AssetKind kind;
        uint256 tokenId;
        uint256 amount;       // ERC-1155 quantity (1 for ERC-721)
        address paymentToken; // address(0) = native
        uint256 price;        // total price
        uint256 expiry;       // 0 = no expiry
        bool active;
    }

    uint256 public constant MAX_FEE_BPS = 1_000; // hard cap: 10%

    uint256 public feeBps;
    address public treasury;
    uint256 public nextListingId = 1;

    mapping(uint256 => Listing) public listings;
    mapping(address => bool) public allowedPaymentTokens;
    mapping(address => bool) public allowedAssetContracts;

    event Listed(
        uint256 indexed listingId,
        address indexed seller,
        address assetContract,
        uint256 tokenId,
        uint256 amount,
        address paymentToken,
        uint256 price,
        uint256 expiry
    );
    event Purchased(
        uint256 indexed listingId,
        address indexed buyer,
        address indexed seller,
        uint256 price,
        uint256 fee,
        address paymentToken
    );
    event Cancelled(uint256 indexed listingId, address indexed seller);
    event PriceUpdated(uint256 indexed listingId, uint256 newPrice);
    event FeeUpdated(uint256 oldBps, uint256 newBps);
    event TreasuryUpdated(address oldTreasury, address newTreasury);
    event PaymentTokenAllowed(address indexed token, bool allowed);
    event AssetContractAllowed(address indexed asset, bool allowed);

    error NotSeller();
    error ListingInactive();
    error ListingExpired();
    error NotExpired();
    error BadPrice();
    error BadAmount();
    error FeeTooHigh();
    error PaymentNotAllowed();
    error AssetNotAllowed();
    error WrongPayment();
    error ZeroAddress();
    error CannotBuyOwn();

    constructor(uint256 initialFeeBps, address initialTreasury) Ownable(msg.sender) {
        if (initialTreasury == address(0)) revert ZeroAddress();
        if (initialFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = initialFeeBps;
        treasury = initialTreasury;
    }

    function setFeeBps(uint256 newFeeBps) external onlyOwner {
        if (newFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        emit FeeUpdated(feeBps, newFeeBps);
        feeBps = newFeeBps;
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, newTreasury);
        treasury = newTreasury;
    }

    function setPaymentTokenAllowed(address token, bool allowed) external onlyOwner {
        allowedPaymentTokens[token] = allowed;
        emit PaymentTokenAllowed(token, allowed);
    }

    function setAssetContractAllowed(address asset, bool allowed) external onlyOwner {
        allowedAssetContracts[asset] = allowed;
        emit AssetContractAllowed(asset, allowed);
    }

    /// @notice Escrow an ERC-721 ship and list it.
    function listERC721(
        address assetContract,
        uint256 tokenId,
        address paymentToken,
        uint256 price,
        uint256 expiry
    ) external nonReentrant returns (uint256 listingId) {
        if (price == 0) revert BadPrice();
        if (!allowedAssetContracts[assetContract]) revert AssetNotAllowed();
        if (paymentToken != address(0) && !allowedPaymentTokens[paymentToken]) revert PaymentNotAllowed();

        IERC721(assetContract).transferFrom(msg.sender, address(this), tokenId);
        listingId = _createListing(msg.sender, assetContract, AssetKind.ERC721, tokenId, 1, paymentToken, price, expiry);
    }

    /// @notice Escrow ERC-1155 items and list them.
    function listERC1155(
        address assetContract,
        uint256 tokenId,
        uint256 amount,
        address paymentToken,
        uint256 price,
        uint256 expiry
    ) external nonReentrant returns (uint256 listingId) {
        if (price == 0) revert BadPrice();
        if (amount == 0) revert BadAmount();
        if (!allowedAssetContracts[assetContract]) revert AssetNotAllowed();
        if (paymentToken != address(0) && !allowedPaymentTokens[paymentToken]) revert PaymentNotAllowed();

        IERC1155(assetContract).safeTransferFrom(msg.sender, address(this), tokenId, amount, "");
        listingId = _createListing(
            msg.sender,
            assetContract,
            AssetKind.ERC1155,
            tokenId,
            amount,
            paymentToken,
            price,
            expiry
        );
    }

    function _createListing(
        address seller,
        address assetContract,
        AssetKind kind,
        uint256 tokenId,
        uint256 amount,
        address paymentToken,
        uint256 price,
        uint256 expiry
    ) private returns (uint256 listingId) {
        listingId = nextListingId++;
        listings[listingId] = Listing({
            seller: seller,
            assetContract: assetContract,
            kind: kind,
            tokenId: tokenId,
            amount: amount,
            paymentToken: paymentToken,
            price: price,
            expiry: expiry,
            active: true
        });
        emit Listed(listingId, seller, assetContract, tokenId, amount, paymentToken, price, expiry);
    }

    function buy(uint256 listingId) external payable nonReentrant {
        Listing memory l = listings[listingId];
        if (!l.active) revert ListingInactive();
        if (l.expiry != 0 && block.timestamp > l.expiry) revert ListingExpired();
        if (msg.sender == l.seller) revert CannotBuyOwn();

        uint256 fee = (l.price * feeBps) / 10_000;
        uint256 sellerProceeds = l.price - fee;

        // Effects first.
        delete listings[listingId];

        // Interactions.
        if (l.paymentToken == address(0)) {
            if (msg.value != l.price) revert WrongPayment();
            if (fee > 0) _sendNative(treasury, fee);
            _sendNative(l.seller, sellerProceeds);
        } else {
            if (msg.value != 0) revert WrongPayment();
            IERC20 token = IERC20(l.paymentToken);
            token.safeTransferFrom(msg.sender, address(this), l.price);
            if (fee > 0) token.safeTransfer(treasury, fee);
            token.safeTransfer(l.seller, sellerProceeds);
        }

        _transferAsset(l, msg.sender);

        emit Purchased(listingId, msg.sender, l.seller, l.price, fee, l.paymentToken);
    }

    function _transferAsset(Listing memory l, address to) private {
        if (l.kind == AssetKind.ERC721) {
            IERC721(l.assetContract).transferFrom(address(this), to, l.tokenId);
        } else {
            IERC1155(l.assetContract).safeTransferFrom(address(this), to, l.tokenId, l.amount, "");
        }
    }

    function _sendNative(address to, uint256 amount) private {
        (bool ok, ) = payable(to).call{value: amount}("");
        require(ok, "native transfer failed");
    }

    function cancel(uint256 listingId) external nonReentrant {
        Listing memory l = listings[listingId];
        if (!l.active) revert ListingInactive();
        if (l.seller != msg.sender) revert NotSeller();

        delete listings[listingId];
        _transferAsset(l, l.seller);
        emit Cancelled(listingId, l.seller);
    }

    function updatePrice(uint256 listingId, uint256 newPrice) external {
        Listing storage l = listings[listingId];
        if (!l.active) revert ListingInactive();
        if (l.seller != msg.sender) revert NotSeller();
        if (newPrice == 0) revert BadPrice();
        l.price = newPrice;
        emit PriceUpdated(listingId, newPrice);
    }

    /// @notice Reclaim an expired listing's escrowed asset.
    function reclaimExpired(uint256 listingId) external nonReentrant {
        Listing memory l = listings[listingId];
        if (!l.active) revert ListingInactive();
        if (l.expiry == 0 || block.timestamp <= l.expiry) revert NotExpired();

        delete listings[listingId];
        _transferAsset(l, l.seller);
        emit Cancelled(listingId, l.seller);
    }

    function getListing(uint256 listingId) external view returns (Listing memory) {
        return listings[listingId];
    }

    function isActive(uint256 listingId) external view returns (bool) {
        Listing memory l = listings[listingId];
        return l.active && (l.expiry == 0 || block.timestamp <= l.expiry);
    }

    function quote(uint256 listingId) external view returns (uint256 fee, uint256 sellerProceeds) {
        Listing memory l = listings[listingId];
        fee = (l.price * feeBps) / 10_000;
        sellerProceeds = l.price - fee;
    }
}
