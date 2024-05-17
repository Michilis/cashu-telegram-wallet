module.exports = {
  pendingMessage: (username, token, cashuApiUrl) => `
${username} shared a Cashu token 🥜

Click here to claim to Lightning: [Claim link](${cashuApiUrl}?token=${token})
  `,
  claimedMessage: (username) => `
@${username} shared a Cashu token 🥜

Cashu token has been claimed ✅
  `,
  errorMessage: 'Error processing your request. Please try again later.',
  helpMessage: `
Welcome to the Cashu Telegram Bot!

To get started, please set your Lightning address by sending the command:
/add <your-lightning-address>

For example:
/add example@eenentwintig.net

After setting your Lightning address, you can send Cashu tokens here, and they will be sent to your specified address.
Use the following commands:
/balance - Check your wallet balance
/send <amount> - Create a Cashu token from your wallet balance
  `,
  startTutorial: `
Welcome to the Cashu Telegram Bot!

Let's get you started with setting up your Lightning address.

Please send your Lightning address (e.g., example@eenentwintig.net) using the command:
/add <your-lightning-address>

After setting your Lightning address, you can send Cashu tokens here, and they will be sent to your specified address.
  `,
  checkingTokenStatus: 'Checking token status...',
  tokenStatusButtonPending: 'Token Status: Pending',
};
