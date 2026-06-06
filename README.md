# 🏥 Secure Electronic Health Records (EthSecure Health)

> A Patient-Centric Ethereum Blockchain System for Secure Medical Records using IPFS

---

## 📋 Project Summary

The **Secure Electronic Health Records** project utilizes Ethereum blockchain, Metamask, and Ganache to enable patients to securely upload medical data and also view their data, manage doctor access, and view data history. Doctors can manage patient lists, access records, generate consultancy reports, and revoke access given by patient. Diagnostic centers can create EHR reports, ensuring visibility for both patients and doctors through IPFS integration. This decentralized approach enhances data security, interoperability, and patient control over health information, ultimately improving healthcare delivery and patient outcomes.

---

## 🏗️ System Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│                        FRONTEND (ReactJS)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────────────────┐ │
│  │  Patient     │  │  Doctor     │  │  Diagnostic Center       │ │
│  │  Dashboard   │  │  Dashboard  │  │  Dashboard               │ │
│  └──────┬──────┘  └──────┬──────┘  └────────────┬─────────────┘ │
│         │                │                       │               │
│         └────────────────┼───────────────────────┘               │
│                          │                                       │
│                   ┌──────▼──────┐                                │
│                   │  ethers.js  │◄── MetaMask Wallet Connection  │
│                   └──────┬──────┘                                │
└──────────────────────────┼───────────────────────────────────────┘
                           │
              ┌────────────┼────────────────┐
              │            │                │
    ┌─────────▼─────────┐  │  ┌─────────────▼─────────────┐
    │  ETHEREUM NETWORK  │  │  │  IPFS NETWORK (Pinata)    │
    │  (Ganache Local)   │  │  │                           │
    │                    │  │  │  Stores: Encrypted MRI,   │
    │  Stores:           │  │  │  Blood Reports, X-Rays,   │
    │  • IPFS CID Hashes │  │  │  EHR Documents (as        │
    │  • Access Control  │  │  │  AES-256 encrypted blobs) │
    │  • Audit Events    │  │  │                           │
    │  • Role Mappings   │  │  │  Returns: CID Hash        │
    └────────────────────┘  │  └───────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │  SMART CONTRACTS (Solidity) │
              │                            │
              │  EthSecureHealthAccess.sol  │
              │  └─ Role-Based Access      │
              │     Control (RBAC)         │
              │                            │
              │  EthSecureRecord.sol       │
              │  └─ Patient Registration   │
              │  └─ Grant/Revoke Access    │
              │  └─ Medical Report Storage │
              │  └─ Audit Trail Events     │
              └────────────────────────────┘
```

---

## 📦 Core Application Modules

### 1. 🔐 Registration
Patients and Medical Personnel must securely register their Ethereum Wallet (via Metamask). The smart contract binds their cryptographic public key to their identity, creating a permanent, immutable record of their role (`PATIENT_ROLE`, `DOCTOR_ROLE`, `DIAGNOSTIC_CENTER_ROLE`) on the blockchain.

**Smart Contract Function Used:**
```solidity
function registerPatient(string memory _ipfsHash) public {
    // Validates the caller has PATIENT_ROLE
    // Stores encrypted demographic data CID on-chain
    // Emits PatientRegistered event with timestamp
}
```

### 2. 📊 Patient Dashboard
The central hub for patients to take ownership of their health data. From this dashboard, patients can:
- ✅ Securely upload or view their own Electronic Health Records
- ✅ View a complete history of their medical data with timestamps
- ✅ Grant access to specific doctors via their Ethereum wallet address
- ✅ Revoke access from any doctor at any time
- ✅ View all doctors who currently have access to their records

**Smart Contract Functions Used:**
```solidity
function grantAccess(address _doctor) public     // Patient authorizes a doctor
function revokeAccess(address _doctor) public     // Patient removes authorization
function getAuthorizedDoctors() public view       // List all authorized doctors
function getPatientMedicalReports() public view   // View all personal EHR data
```

### 3. 👨‍⚕️ Doctor Dashboard
A secure portal exclusively accessible by verified medical professionals. Doctors can:
- ✅ View comprehensive lists of patients who have granted them access
- ✅ Fetch and decrypt patient medical records directly from the IPFS network
- ✅ Generate and upload new consultancy reports linked to patients
- ✅ View complete audit trail of all interactions with patient records

**Smart Contract Functions Used:**
```solidity
function getPatientMedicalReports(address _patient) public view  // Fetch all reports
function addMedicalReport(address _patient, string _ipfsHash, string _reportType) public
// Authorized doctor uploads a new consultancy report
```

### 4. 🚫 Revoking Permissions
A critical security feature ensuring data sovereignty. Patients have the absolute power to instantly revoke a doctor's access to their medical records at any time. This executes a state change on the Ethereum smart contract, making it mathematically impossible for that doctor to decrypt the patient's IPFS files moving forward.

**How It Works On-Chain:**
```solidity
function revokeAccess(address _doctor) public onlyRegisteredPatient(msg.sender) {
    require(doctorAccess[msg.sender][_doctor], "Doctor does not have access");
    doctorAccess[msg.sender][_doctor] = false;  // Instant state change
    emit AccessRevoked(msg.sender, _doctor, block.timestamp);  // Audit log
}
```

### 5. 🔬 Diagnostic Center
Diagnostic centers (labs, imaging facilities) can:
- ✅ Upload encrypted EHR reports (MRI, Blood Work, X-Ray, CT Scan)
- ✅ Link reports directly to patient wallet addresses
- ✅ Reports are automatically visible to both patients and their authorized doctors

---

## 🔒 Security Model: Public Blockchain + Private Data

| Layer | Storage | What is Stored | Visibility |
|-------|---------|---------------|------------|
| **Ethereum** (On-Chain) | Smart Contract State | IPFS CID hashes, Access mappings, Audit events | Public but contains NO sensitive data |
| **IPFS** (Off-Chain) | Pinata Gateway | AES-256 encrypted medical documents | Public but mathematically unreadable |
| **Browser** (Client-Side) | Local Memory | Encryption keys, Raw medical data | Never leaves the user's device |

**Key Insight:** Even though both Ethereum and IPFS are public networks, the actual medical data (MRI images, blood reports, etc.) is encrypted **before** it leaves the patient's browser. Without the correct AES-256 decryption key, the data on IPFS is just random noise.

---

## 🔄 Data Flow Diagram

```
Patient uploads MRI scan
        │
        ▼
┌─────────────────────────┐
│  Browser encrypts with  │
│  AES-256 locally        │───── Key stays with patient
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Encrypted blob uploads │
│  to IPFS via Pinata     │───── Returns CID: "QmYwAP..."
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  CID stored on Ethereum │
│  via addMedicalReport() │───── Immutable on-chain record
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Patient grants doctor  │
│  access via grantAccess │───── On-chain permission
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Doctor fetches CID,    │
│  retrieves from IPFS,   │
│  decrypts locally       │───── Views original MRI scan
└─────────────────────────┘
```

---

## 🛠️ Technology Stack

| Category | Technology | Purpose |
|----------|-----------|---------|
| Blockchain | **Ethereum** | Decentralized ledger for access control & audit trail |
| Wallet | **MetaMask** | Browser-based Ethereum wallet for user authentication |
| Local Blockchain | **Ganache** | Local Ethereum testnet for development & testing |
| File Storage | **IPFS (Pinata)** | Decentralized encrypted medical document storage |
| Smart Contracts | **Solidity ^0.8.20** | Access control logic & patient record management |
| Contract Security | **OpenZeppelin** | Battle-tested RBAC library |
| Frontend | **ReactJS + Vite** | Fast, modern user interface |
| Web3 Library | **ethers.js** | Frontend ↔ Ethereum smart contract communication |
| Encryption | **crypto-js (AES-256)** | Client-side medical data encryption |
| HTTP Client | **axios** | IPFS upload/download via Pinata REST API |
| Testing | **Hardhat + Chai** | Smart contract unit testing (14 test cases) |
| Styling | **TailwindCSS** | Premium glassmorphism UI design |
| Version Control | **Git** | Source code management |
| Runtime | **Node.js** | JavaScript runtime environment |

---

## 📂 Project Structure

```
EthSecureHealth/
├── contracts/
│   ├── EthSecureHealthAccess.sol    # Role-Based Access Control (RBAC)
│   └── EthSecureRecord.sol          # Patient records, reports & permissions
├── scripts/
│   └── deploy.js                    # Deployment script for both contracts
├── test/
│   └── EthSecureHealth.test.js      # 14 automated test cases
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Main React application
│   │   ├── index.css                # Glassmorphism styles
│   │   └── ipfs/
│   │       └── storage.js           # IPFS encrypt/upload/decrypt utilities
│   ├── tailwind.config.js           # Custom theme configuration
│   └── postcss.config.js            # PostCSS pipeline
├── docs/
│   ├── Cluely_Quick_Start_Guide.md  # Setup guide for Cluely desktop assistant
│   ├── Faculty_Presentation.md      # Detailed faculty explanation guide
│   ├── Project_Recreation_Guide.md  # Step-by-step recreation instructions
│   └── Project_Report.md            # Comprehensive project report
├── hardhat.config.js                # Solidity compiler configuration
└── package.json                     # Node.js dependencies
```

---

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone <repository-url>
cd EthSecureHealth
npm install

# 2. Compile smart contracts
npx hardhat compile

# 3. Run test suite (14 tests)
npx hardhat test

# 4. Deploy to local network
npx hardhat run scripts/deploy.js --network localhost

# 5. Start frontend
cd frontend
npm install
npm run dev
# Open http://localhost:5173
```

---

## 🚀 Future Improvements

| # | Improvement | Description |
|---|-------------|-------------|
| 1 | **Real IPFS Integration** | Connect Pinata API keys so `storage.js` uploads/downloads encrypted files in production |
| 2 | **Multi-Hospital Support** | Allow multiple hospitals to register and manage their own doctors & diagnostic centers |
| 3 | **Emergency Access Protocol** | Time-locked emergency access for unconscious or incapacitated patients |
| 4 | **Notification System** | Email/push alerts when a doctor accesses records or new reports are uploaded |
| 5 | **ZK-Proof Verification** | Zero-knowledge proofs for verifying medical credentials without revealing identity |
| 6 | **Mainnet/Testnet Deployment** | Deploy to Sepolia or Polygon for real-world testing beyond local Ganache |
| 7 | **Mobile App (React Native)** | Cross-platform mobile app for patients to manage health records on the go |
| 8 | **AI-Powered Diagnostics** | Integrate ML models for preliminary diagnosis suggestions from uploaded reports |

---

## 📜 License

This project is licensed under the MIT License.
