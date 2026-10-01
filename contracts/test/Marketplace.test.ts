import { expect } from 'chai';
import { ethers } from 'hardhat';

describe('Marketplace', () => {
  async function deploy() {
    const [owner, seller, buyer, treasury] = await ethers.getSigners();

    const ShipNFT = await ethers.getContractFactory('ShipNFT');
    const ship = await ShipNFT.deploy('Rocket Rift Ship', 'RIFTSHIP', 'ipfs://base/');

    const Marketplace = await ethers.getContractFactory('Marketplace');
    const market = await Marketplace.deploy(250, treasury.address); // 2.5%

    await market.setAssetContractAllowed(await ship.getAddress(), true);

    const stats = { health: 100, shield: 50, damage: 10, speed: 700, fireRate: 100, critChance: 500, cargo: 10 };
    await ship.mint(seller.address, 'raptor_x', 0, 1, stats, 'ipfs://ship/1.json');

    return { owner, seller, buyer, treasury, ship, market, stats };
  }

  it('escrows, sells, and pays the fee', async () => {
    const { seller, buyer, treasury, ship, market } = await deploy();
    const shipAddr = await ship.getAddress();

    await ship.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).listERC721(shipAddr, 1, ethers.ZeroAddress, ethers.parseEther('1'), 0);

    expect(await ship.ownerOf(1)).to.equal(await market.getAddress());

    const [fee, proceeds] = await market.quote(1);
    expect(fee).to.equal(ethers.parseEther('0.025'));
    expect(proceeds).to.equal(ethers.parseEther('0.975'));

    const before = await ethers.provider.getBalance(treasury.address);
    await market.connect(buyer).buy(1, { value: ethers.parseEther('1') });
    const after = await ethers.provider.getBalance(treasury.address);

    expect(after - before).to.equal(ethers.parseEther('0.025'));
    expect(await ship.ownerOf(1)).to.equal(buyer.address);
  });

  it('rejects a wrong payment amount', async () => {
    const { seller, buyer, ship, market } = await deploy();
    const shipAddr = await ship.getAddress();
    await ship.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).listERC721(shipAddr, 1, ethers.ZeroAddress, ethers.parseEther('1'), 0);

    await expect(market.connect(buyer).buy(1, { value: ethers.parseEther('0.5') })).to.be.revertedWithCustomError(
      market,
      'WrongPayment'
    );
  });

  it('lets the seller cancel and reclaim', async () => {
    const { seller, ship, market } = await deploy();
    const shipAddr = await ship.getAddress();
    await ship.connect(seller).approve(await market.getAddress(), 1);
    await market.connect(seller).listERC721(shipAddr, 1, ethers.ZeroAddress, ethers.parseEther('1'), 0);
    await market.connect(seller).cancel(1);
    expect(await ship.ownerOf(1)).to.equal(seller.address);
  });

  it('caps the fee at 10%', async () => {
    const { market } = await deploy();
    await expect(market.setFeeBps(1001)).to.be.revertedWithCustomError(market, 'FeeTooHigh');
  });
});
