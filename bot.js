const TelegramBot = require('node-telegram-bot-api');
const { CashuMint, CashuWallet, getDecodedToken, getEncodedToken } = require('@cashu/cashu-ts');
const QRCode = require('qrcode');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const messages = require('./messages');

// Load environment variables
const token = process.env.TELEGRAM_BOT_TOKEN;
const cashuApiUrl = process.env.CASHU_API_URL;
const defaultMintUrl = process.env.DEFAULT_MINT_URL;
const checkInterval = parseInt(process.env.CHECK_INTERVAL, 10) || 10;
const claimedDisposeTiming = parseInt(process.env.CLAIMED_DISPOSE_TIMING, 10) || 10;

const bot = new TelegramBot(token, { polling: true });

// Directory to store QR code images and user data
const qrCodeDir = './qrcodes';
const dataDir = './data';
if (!fs.existsSync(qrCodeDir)) fs.mkdirSync(qrCodeDir);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);

// Function to check if the Cashu token has been spent
async function checkTokenStatus(tokenEncoded) {
    try {
        const token = getDecodedToken(tokenEncoded);
        const mintUrl = token.token[0].mint;
        const proofs = token.token[0].proofs;

        const mint = new CashuMint(mintUrl);
        const keys = await mint.getKeys();
        const wallet = new CashuWallet(mint, keys);

        const spentProofs = await wallet.checkProofsSpent(proofs);
        const status = spentProofs.length === proofs.length ? 'spent' : 'pending';
        return status;
    } catch (error) {
        console.error('Error checking token:', error);
        throw error;
    }
}

// Function to generate a QR code for the token
async function generateQRCode(token) {
    const filePath = path.join(qrCodeDir, `${Date.now()}.png`);
    await QRCode.toFile(filePath, token);
    return filePath;
}

// Function to delete the QR code image
function deleteQRCode(filePath) {
    fs.unlink(filePath, (err) => {
        if (err) console.error(`Error deleting file ${filePath}:`, err);
    });
}

// Function to get user data
function getUserData(chatId) {
    const userFilePath = path.join(dataDir, `${chatId}.json`);
    if (fs.existsSync(userFilePath)) {
        return JSON.parse(fs.readFileSync(userFilePath));
    }
    return { balance: [], lightningAddress: null };
}

// Function to save user data
function saveUserData(chatId, userData) {
    const userFilePath = path.join(dataDir, `${chatId}.json`);
    fs.writeFileSync(userFilePath, JSON.stringify(userData, null, 2));
}

// Function to handle setting a Lightning address
function setLightningAddress(chatId, address) {
    const userData = getUserData(chatId);
    userData.lightningAddress = address;
    saveUserData(chatId, userData);
}

// Function to get a user's Lightning address
function getLightningAddress(chatId) {
    const userData = getUserData(chatId);
    return userData.lightningAddress;
}

// Function to handle adding a token to user's balance
function addTokenToBalance(chatId, token) {
    const userData = getUserData(chatId);
    userData.balance.push(token);
    saveUserData(chatId, userData);
}

// Function to handle generating a token from user's balance
async function generateTokenFromBalance(chatId, amount) {
    const userData = getUserData(chatId);
    const mintUrl = defaultMintUrl;

    const mint = new CashuMint(mintUrl);
    const keys = await mint.getKeys();
    const wallet = new CashuWallet(mint, keys);

    const proofs = userData.balance.flatMap(token => getDecodedToken(token).token[0].proofs);
    const { send, returnChange } = await wallet.send(amount, proofs);

    userData.balance = returnChange.map(proof => getEncodedToken({ token: [{ mint: mintUrl, proofs: [proof] }] }));
    saveUserData(chatId, userData);

    return getEncodedToken({ token: [{ mint: mintUrl, proofs: send }] });
}

// Function to handle new messages
async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const text = msg.text;
    const username = msg.from.username ? `@${msg.from.username}` : msg.from.first_name;

    if (msg.chat.type === 'private') {
        const userAddress = getLightningAddress(chatId);
        if (text.startsWith('/balance')) {
            const userData = getUserData(chatId);
            const balance = userData.balance.flatMap(token => getDecodedToken(token).token[0].proofs).reduce((acc, proof) => acc + proof.amount, 0);
            bot.sendMessage(chatId, `Your balance is ${balance} sats.`);
        } else if (text.startsWith('/send ')) {
            const amount = parseInt(text.split(' ')[1], 10);
            if (isNaN(amount)) {
                bot.sendMessage(chatId, 'Invalid amount. Please try again.');
            } else {
                const token = await generateTokenFromBalance(chatId, amount);
                bot.sendMessage(chatId, `Here is your Cashu token for ${amount} sats:\n\n${token}`);
            }
        } else if (userAddress) {
            try {
                const decodedToken = getDecodedToken(text);
                addTokenToBalance(chatId, text);
                bot.sendMessage(chatId, 'Token added to your wallet.');
            } catch (error) {
                console.error('Error processing message:', error);
                bot.sendMessage(chatId, messages.helpMessage);
            }
        } else {
            bot.sendMessage(chatId, messages.helpMessage);
        }
    } else if (msg.text && msg.text.startsWith('cashu')) {
        handleMessage(msg);
    }
}

// Listener for any text message
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    if (text.startsWith('/add ')) {
        const address = text.split(' ')[1];
        if (address && address.includes('@')) {
            setLightningAddress(chatId, address);
            bot.sendMessage(chatId, 'Lightning address set successfully.');
        } else {
            bot.sendMessage(chatId, 'Invalid Lightning address. Please try again.');
        }
    } else if (text.startsWith('/start')) {
        bot.sendMessage(chatId, messages.startTutorial);
    } else {
        handleMessage(msg);
    }
});

// Handle callback queries (button presses)
bot.on('callback_query', async (callbackQuery) => {
    const msg = callbackQuery.message;
    const chatId = msg.chat.id;
    const data = callbackQuery.data;
    const username = msg.caption.split(' ')[0].substring(1); // Extract the username from the message caption

    try {
        // Decode the token from the message caption
        const token = msg.caption.split('\n\n')[1];
        const status = await checkTokenStatus(token);

        if (data === 'pending' && status === 'spent') {
            // Add token to user's balance
            addTokenToBalance(chatId, token);

            // Update the message, remove the QR code, and stop the interval
            await bot.editMessageText(messages.claimedMessage(username), {
                chat_id: chatId,
                message_id: msg.message_id,
                parse_mode: 'Markdown',
                disable_web_page_preview: true,
            });
            await bot.editMessageReplyMarkup({ inline_keyboard: [] }, {
                chat_id: chatId,
                message_id: msg.message_id
            });
        }
    } catch (error) {
        if (error.code !== 'ETELEGRAM' || !error.response || error.response.description !== 'Bad Request: message is not modified') {
            console.error('Error handling callback query:', error);
        }
    }
});

// Error handling to keep the bot running
process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});
