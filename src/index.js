import { ethers } from 'ethers';

import { apps } from '../ecosystem.config.js';
import { Coincap } from './Coincap.js';
import { Configuration } from './Configuration.js';
import { Uniswap } from './Uniswap.js';
import { wrapAsBigNumber } from './utils/wrapAsBigNumber.js';

console.log('Configuring oracle...');

const config = new Configuration(apps[0].env);

const { asset, network, settleOnBand, settleOnTime, uniswapAddress } = config;
const oracleAddress = config.walletAddress;

console.log('Configuration is', {
  asset,
  network,
  oracleAddress,
  settleOnBand,
  settleOnTime,
  uniswapAddress,
});

const coincap = new Coincap(config);
const uniswap = new Uniswap(config, coincap);

const contract = config.marketContract();
console.log('contract', contract);

let ceiling;
let decimals;
let expiration;
let floor;
let isSettled;
let startPid;
let watcherPid;

// Shutdown

const shutdown = (reason = 'Contract already settled') => {
  clearTimeout(startPid);
  coincap.stop();
  console.log(reason);
  console.log('Goodbye!');
  setTimeout(() => shutdown(reason), 1000000000);
};

const stopWatcher = () => {
  clearInterval(watcherPid);
};

// Core actions

const displayMetrics = () => {
  console.log(
    '------------',
    '\nFloor:',
    floor.toFixed(),
    '\nPrice:',
    uniswap.price.toFixed(),
    '\nCeiling:',
    ceiling.toFixed(),
    '\nExpiration:',
    expiration.toUTCString(),
    '\nNow:',
    (new Date()).toUTCString(),
    '\n------------',
  );
};

const settle = async () => {
  if (!isSettled) {
    console.log('Settlement Triggered...');

    const overrides = {
      gasLimit: 200000,
      gasPrice: ethers.utils.parseUnits('30', 'gwei'),
    };

    displayMetrics();

    const price = uniswap.price.multipliedBy(10 ** decimals);

    return new Promise((resolve) => {
      setTimeout(async () => {
        const result = await contract.oracleCallBack(price.dp(0).toFixed(), overrides);
        resolve(result);
      }, 30000);
    });
  }

  return true;
};

const watcher = async () => {
  if (settleOnTime && expiration < new Date()) {
    stopWatcher();
    await settle();
    shutdown('Contract settled due to time breach');
  }

  if (settleOnBand && (ceiling.isLessThan(uniswap.price) || floor.isGreaterThan(uniswap.price))) {
    stopWatcher();
    await settle();
    shutdown('Contract settled due to band breach');
  }
};

// Initialization

const initWatcher = () => {
  watcherPid = setInterval(watcher, 250);
};

const main = async () => {
  uniswap.start();

  console.log('Fetching contract metadata...');
  const data = await Promise.all([
    contract.EXPIRATION(),
    contract.isSettled(),
    contract.PRICE_CAP(),
    contract.PRICE_DECIMAL_PLACES(),
    contract.PRICE_FLOOR(),
  ]);

  stopWatcher();

  let exp;
  let priceCap;
  let priceFloor;

  [exp, isSettled, priceCap, decimals, priceFloor] = data;

  expiration = new Date(exp * 1000);

  ceiling = (await wrapAsBigNumber(priceCap)).dividedBy(10 ** decimals);
  floor = (await wrapAsBigNumber(priceFloor)).dividedBy(10 ** decimals);

  displayMetrics();

  if (isSettled) {
    shutdown();
    return;
  }

  initWatcher();
};

// Run Lola, Run

startPid = setInterval(main, 30000);
