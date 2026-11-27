// BSC (BEP-20) Hot Wallet Payout Engine for BlockNexa
// Handles key normalization, live USDT/BNB balances, recipient safety checks,
// serialized nonce mutex, pre-broadcast txHash persistence, and on-chain Transfer log verification.
const { ethers } = require('ethers');

const DEFAULT_RPC = 'https://bsc-dataseed.binance.org/';
const DEFAULT_USDT = '0x55d398326f99059fF775485246999027B3197955'; // Official Binance-Peg BSC-USD (18 decimals)
const ZERO_ADDR = '0x0000000000000000000000000000000000000000';
const DEAD_ADDR = '0x000000000000000000000000000000000000dEaD';

const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
];
const ERC20_IFACE = new ethers.Interface(ERC20_ABI);

class PreflightError extends Error {
  constructor(msg) { super(msg); this.name = 'PreflightError'; this.safeToUnlock = true; }
}

function normalizePrivateKey(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^0x[0-9a-fA-F]{64}$/.test(s)) return s;
  if (/^[0-9a-fA-F]{64}$/.test(s)) return '0x' + s;
  return 'INVALID';
}

function createBscPayout(opts = {}) {
  const rpcUrl = String(opts.rpcUrl || process.env.BSC_RPC_URL || DEFAULT_RPC).trim();
  const chainId = Number(opts.chainId || process.env.BSC_CHAIN_ID || 56);
  const usdtAddress = ethers.getAddress(String(opts.usdtContract || process.env.BSC_USDT_CONTRACT || DEFAULT_USDT).trim());
  const explorer = String(opts.explorer || process.env.BSCSCAN_URL || 'https://bscscan.com').replace(/\/+$/, '');
  const normKey = normalizePrivateKey(opts.privateKey !== undefined ? opts.privateKey : process.env.HOT_WALLET_PRIVATE_KEY);

  let provider = null, wallet = null, token = null, cachedDecimals = null;
  let statusCache = { at: 0, data: null };
  let queue = Promise.resolve();

  const configured = normKey !== '' && normKey !== 'INVALID';
  const keyInvalid = normKey === 'INVALID';

  function ensureClient() {
    if (!configured) throw new PreflightError(keyInvalid ? 'HOT_WALLET_PRIVATE_KEY in .env is invalid (must be 64 hex characters).' : 'Hot wallet is not configured yet. Add HOT_WALLET_PRIVATE_KEY in .env.');
    if (!provider) {
      provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
      wallet = new ethers.Wallet(normKey, provider);
      token = new ethers.Contract(usdtAddress, ERC20_ABI, provider);
    }
    return { provider, wallet, token };
  }

  async function getDecimals() {
    if (cachedDecimals !== null) return cachedDecimals;
    const { token: t } = ensureClient();
    const d = Number(await t.decimals());
    if (!Number.isInteger(d) || d < 6 || d > 24) throw new PreflightError('Unexpected USDT token decimals on RPC.');
    cachedDecimals = d;
    return d;
  }

  function microToUnits(usdtMicro, decimals) {
    return BigInt(usdtMicro) * (10n ** BigInt(decimals - 6));
  }

  async function getStatus(force = false) {
    if (!configured) {
      return {
        configured: false,
        keyInvalid,
        address: null,
        usdt: 0,
        bnb: 0,
        chainId,
        usdtContract: usdtAddress,
        explorer,
      };
    }
    if (!force && statusCache.data && Date.now() - statusCache.at < 4000) return statusCache.data;
    const { provider: p, wallet: w, token: t } = ensureClient();
    try {
      const [dec, rawUsdt, rawBnb] = await Promise.all([getDecimals(), t.balanceOf(w.address), p.getBalance(w.address)]);
      const data = {
        configured: true,
        keyInvalid: false,
        address: w.address,
        usdt: Number(ethers.formatUnits(rawUsdt, dec)),
        bnb: Number(ethers.formatEther(rawBnb)),
        lowGas: rawBnb < ethers.parseEther('0.0005'),
        chainId,
        usdtContract: usdtAddress,
        explorer,
      };
      statusCache = { at: Date.now(), data };
      return data;
    } catch (e) {
      return {
        configured: true,
        keyInvalid: false,
        address: w.address,
        usdt: null,
        bnb: null,
        rpcError: 'Could not reach BSC RPC (' + (e.shortMessage || e.message || 'network error') + ')',
        chainId,
        usdtContract: usdtAddress,
        explorer,
      };
    }
  }

  function validateAddressSync(toAddr, depositAddress) {
    let checksum;
    try { checksum = ethers.getAddress(String(toAddr || '').trim().toLowerCase()); }
    catch { return { ok: false, error: 'Invalid BSC wallet address.' }; }
    const low = checksum.toLowerCase();
    if (low === ZERO_ADDR.toLowerCase() || low === DEAD_ADDR.toLowerCase()) {
      return { ok: false, error: 'Blocked unsafe burn / zero wallet address.' };
    }
    if (low === usdtAddress.toLowerCase()) {
      return { ok: false, error: 'Blocked: destination is the USDT token contract itself.' };
    }
    if (configured) {
      const { wallet: w } = ensureClient();
      if (low === w.address.toLowerCase()) return { ok: false, error: 'Blocked: destination is your own Hot Wallet address.' };
    }
    if (depositAddress && low === String(depositAddress).trim().toLowerCase()) {
      return { ok: false, error: 'Blocked: destination is your own Deposit address.' };
    }
    return { ok: true, checksum };
  }

  function enqueue(fn) {
    const run = queue.then(fn, fn);
    queue = run.catch(() => {});
    return run;
  }

  async function sendUsdt({ to, usdtMicro, depositAddress, onSigned }) {
    return enqueue(async () => {
      const addrCheck = validateAddressSync(to, depositAddress);
      if (!addrCheck.ok) throw new PreflightError(addrCheck.error);
      const checksumTo = addrCheck.checksum;

      const { provider: p, wallet: w, token: t } = ensureClient();
      let net, dec, rawUsdt, rawBnb, rawGasPrice, nonce;
      try {
        [net, dec, rawUsdt, rawBnb, rawGasPrice, nonce] = await Promise.all([
          p.getNetwork(),
          getDecimals(),
          t.balanceOf(w.address),
          p.getBalance(w.address),
          p.send('eth_gasPrice', []),
          p.getTransactionCount(w.address, 'pending'),
        ]);
      } catch (e) {
        throw new PreflightError('BSC RPC connection failed: ' + (e.shortMessage || e.message));
      }
      if (Number(net.chainId) !== chainId) {
        throw new PreflightError(`BSC RPC chainId mismatch: expected ${chainId}, got ${net.chainId}.`);
      }

      const amountUnits = microToUnits(usdtMicro, dec);
      if (rawUsdt < amountUnits) {
        const have = Number(ethers.formatUnits(rawUsdt, dec)).toFixed(2);
        const need = (usdtMicro / 1e6).toFixed(2);
        throw new PreflightError(`Insufficient Hot Wallet USDT: wallet has ${have} USDT, order needs ${need} USDT.`);
      }

      const data = ERC20_IFACE.encodeFunctionData('transfer', [checksumTo, amountUnits]);
      let gasEst = 65000n;
      try {
        const est = await p.estimateGas({ from: w.address, to: usdtAddress, data });
        gasEst = (est * 125n) / 100n;
        if (gasEst < 55000n) gasEst = 55000n;
        if (gasEst > 250000n) gasEst = 250000n;
      } catch (e) {
        throw new PreflightError('Gas estimation failed on BSC: ' + (e.shortMessage || e.message));
      }

      let gasPrice = rawGasPrice ? BigInt(rawGasPrice) : ethers.parseUnits('3', 'gwei');
      const minGasPrice = ethers.parseUnits('1', 'gwei');
      const maxGasPrice = ethers.parseUnits('25', 'gwei');
      if (gasPrice < minGasPrice) gasPrice = minGasPrice;
      if (gasPrice > maxGasPrice) throw new PreflightError('BSC network gas price is unusually high right now (>25 Gwei). Try again shortly.');
      const gasCost = gasEst * gasPrice;
      if (rawBnb < gasCost) {
        const haveBnb = Number(ethers.formatEther(rawBnb)).toFixed(5);
        const needBnb = Number(ethers.formatEther(gasCost)).toFixed(5);
        throw new PreflightError(`Insufficient Hot Wallet BNB for gas: wallet has ${haveBnb} BNB, needs ~${needBnb} BNB.`);
      }

      const txReq = {
        type: 0,
        to: usdtAddress,
        data,
        value: 0n,
        nonce,
        gasLimit: gasEst,
        gasPrice,
        chainId,
      };
      const rawTx = await w.signTransaction(txReq);
      const txHash = ethers.keccak256(rawTx);

      // Persist txHash BEFORE broadcasting so a crash/restart can NEVER double-send!
      if (typeof onSigned === 'function') await onSigned(txHash);

      try {
        await p.broadcastTransaction(rawTx);
      } catch (e) {
        const msg = String(e.message || '').toLowerCase();
        if (!msg.includes('already known') && !msg.includes('known transaction')) {
          throw e;
        }
      }

      statusCache = { at: 0, data: null };
      const receipt = await p.waitForTransaction(txHash, 1, 90000);
      if (!receipt) {
        const err = new Error('Transaction broadcasted (' + txHash + ') and waiting for BSC block confirmation.');
        err.txHash = txHash;
        err.pendingOnChain = true;
        throw err;
      }
      if (receipt.status !== 1) {
        const err = new PreflightError('Transaction reverted on BSC (' + txHash + '). No USDT was transferred.');
        err.reverted = true;
        throw err;
      }

      // Verify on-chain Transfer(from, to, value) event log
      const matchedTransfer = receipt.logs.some(log => {
        if (String(log.address || '').toLowerCase() !== usdtAddress.toLowerCase()) return false;
        try {
          const parsed = ERC20_IFACE.parseLog(log);
          return parsed && parsed.name === 'Transfer' &&
            parsed.args.from.toLowerCase() === w.address.toLowerCase() &&
            parsed.args.to.toLowerCase() === checksumTo.toLowerCase() &&
            BigInt(parsed.args.value) === amountUnits;
        } catch { return false; }
      });
      if (!matchedTransfer) {
        const err = new Error('Transaction mined (' + txHash + '), but expected USDT Transfer log was not found. Inspect on BscScan.');
        err.txHash = txHash;
        err.pendingOnChain = true;
        throw err;
      }

      return { txHash, blockNumber: receipt.blockNumber };
    });
  }

  async function verifyTxOnChain({ txHash, to, usdtMicro }) {
    if (!configured || !txHash) return { state: 'unknown' };
    try {
      const { provider: p, wallet: w } = ensureClient();
      const dec = await getDecimals();
      const amountUnits = microToUnits(usdtMicro, dec);
      const receipt = await p.getTransactionReceipt(txHash);
      if (!receipt) {
        const tx = await p.getTransaction(txHash);
        return { state: tx ? 'pending' : 'missing' };
      }
      if (receipt.status !== 1) return { state: 'reverted' };
      const checksumTo = ethers.getAddress(String(to).trim().toLowerCase());
      const ok = receipt.logs.some(log => {
        if (String(log.address || '').toLowerCase() !== usdtAddress.toLowerCase()) return false;
        try {
          const parsed = ERC20_IFACE.parseLog(log);
          return parsed && parsed.name === 'Transfer' &&
            parsed.args.from.toLowerCase() === w.address.toLowerCase() &&
            parsed.args.to.toLowerCase() === checksumTo.toLowerCase() &&
            BigInt(parsed.args.value) === amountUnits;
        } catch { return false; }
      });
      return ok ? { state: 'confirmed', blockNumber: receipt.blockNumber } : { state: 'mismatch' };
    } catch {
      return { state: 'unknown' };
    }
  }

  return { getStatus, validateAddressSync, sendUsdt, verifyTxOnChain, PreflightError };
}

module.exports = { createBscPayout, PreflightError };
