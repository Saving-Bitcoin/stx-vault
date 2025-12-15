# STX Vault

A simple timelock smart contract for Stacks blockchain built with Clarity. Lock your STX tokens and only withdraw them after a specified block height.

## What It Does

STX Vault allows you to:
- Deposit STX tokens into the vault
- Set a future block height as the unlock time
- Withdraw your tokens only after the unlock block is reached
- Check your vault balance and unlock status

Perfect for:
- Forced savings/hodling
- Vesting schedules
- Time-based token releases
- Learning Clarity smart contracts

## Features

- **Simple Timelock**: Set a block height, tokens unlock after that block
- **Personal Vaults**: Each user has their own isolated vault
- **Read-Only Queries**: Check balance and unlock time without gas fees
- **Secure**: Can't withdraw before unlock time, no admin backdoors

## Prerequisites

- [Clarinet](https://github.com/hirosystems/clarinet) installed
- Basic understanding of Stacks blockchain
- A Stacks wallet for testnet deployment

## Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/stx-vault.git
cd stx-vault

# Check Clarinet installation
clarinet --version
```

## Project Structure

```
stx-vault/
├── contracts/
│   └── vault.clar          # Main timelock contract
├── tests/
│   └── vault_test.ts       # Contract tests
├── Clarinet.toml           # Project configuration
└── README.md
```

## Usage

### Deploy Locally

```bash
# Start Clarinet console
clarinet console

# Deploy contract
(contract-call? .vault deposit u1000000 u100)
```

### Contract Functions

**deposit (amount, unlock-block)**
```clarity
(contract-call? .vault deposit u1000000 u500)
```
Deposits STX with unlock at block 500

**withdraw**
```clarity
(contract-call? .vault withdraw)
```
Withdraws all STX if unlock block is reached

**get-vault-info (user)**
```clarity
(contract-call? .vault get-vault-info tx-sender)
```
Returns balance and unlock block for a user

**get-current-block**
```clarity
(contract-call? .vault get-current-block)
```
Returns current block height

## Testing

```bash
# Run all tests
clarinet test

# Check contract
clarinet check
```

## Deployment

### Testnet
```bash
clarinet deploy --testnet
```

### Mainnet
```bash
clarinet deploy --mainnet
```

## Learning Goals

Building this contract teaches you:
- ✅ Data storage with maps
- ✅ Block height comparisons
- ✅ STX token transfers
- ✅ Error handling with asserts
- ✅ Read-only vs public functions
- ✅ User-specific data storage

## Block Height Info

Stacks blocks are ~10 minutes each:
- 1 hour ≈ 6 blocks
- 1 day ≈ 144 blocks
- 1 week ≈ 1,008 blocks
- 1 month ≈ 4,320 blocks

## Roadmap

- [ ] Write the core contract
- [ ] Add comprehensive tests
- [ ] Deploy to testnet
- [ ] Add emergency withdraw (optional)
- [ ] Support multiple deposits per user
- [ ] Add events/logging

## Contributing

This is a learning project! Feel free to:
- Open issues for questions
- Submit PRs for improvements
- Fork and experiment

## License

MIT License - do whatever you want with it

## Resources

- [Clarity Language Reference](https://docs.stacks.co/clarity)
- [Clarinet Documentation](https://github.com/hirosystems/clarinet)
- [Stacks Blockchain](https://www.stacks.co/)

---

Built while learning Clarity 🚀
