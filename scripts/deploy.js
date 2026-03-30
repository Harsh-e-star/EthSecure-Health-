/**
 * EthSecure Health - Deployment Script (Hardhat v3 + Ganache)
 * 
 * Usage:
 *   npx hardhat run scripts/deploy.js --network localhost
 */

import hardhat from "hardhat";
import { ethers } from "ethers";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

async function main() {
  // Ensure deployment always uses the latest contract changes
  await hardhat.run("compile", { quiet: true });

  // ─── Connect to local Ganache via Hardhat v3 ─────────────────────
  const connection = await hardhat.network.connect();
  const accounts = await connection.provider.request({ method: "eth_accounts" });

  // Create a standard ethers provider + signers
  const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
  const deployer = await provider.getSigner(accounts[0]);
  const doctor   = await provider.getSigner(accounts[1]);
  const patient  = await provider.getSigner(accounts[2]);

  console.log("");
  console.log("  EthSecure Health - Deployment");
  console.log("  ─────────────────────────────");
  console.log(`  Network   : ${hardhat.network.name || "localhost"}`);
  console.log(`  Deployer  : ${deployer.address}`);
  console.log("");

  // ─── Step 1: Deploy Access Control ───────────────────────────────
  console.log("  [1/4] Deploying EthSecureHealthAccess...");
  const accessABI = JSON.parse(
    readFileSync("artifacts/contracts/EthSecureHealthAccess.sol/EthSecureHealthAccess.json", "utf-8")
  );
  const AccessFactory = new ethers.ContractFactory(accessABI.abi, accessABI.bytecode, deployer);
  const accessControl = await AccessFactory.deploy();
  await accessControl.waitForDeployment();
  const accessAddr = await accessControl.getAddress();
  console.log(`        Done: ${accessAddr}`);

  // ─── Step 2: Deploy Secure Record ────────────────────────────────
  console.log("  [2/4] Deploying EthSecureRecord...");
  const recordABI = JSON.parse(
    readFileSync("artifacts/contracts/EthSecureRecord.sol/EthSecureRecord.json", "utf-8")
  );
  const RecordFactory = new ethers.ContractFactory(recordABI.abi, recordABI.bytecode, deployer);
  const secureRecord = await RecordFactory.deploy(accessAddr);
  await secureRecord.waitForDeployment();
  const recordAddr = await secureRecord.getAddress();
  console.log(`        Done: ${recordAddr}`);

  // ─── Step 3: Setup Demo Roles ────────────────────────────────────
  console.log("  [3/6] Setting up demo roles...");
  const diagnostic = await provider.getSigner(accounts[3]);
  await accessControl.addDoctor(doctor.address);
  console.log(`        Doctor      : ${doctor.address}`);
  await accessControl.addPatient(patient.address);
  console.log(`        Patient     : ${patient.address}`);
  await accessControl.addDiagnosticCenter(diagnostic.address);
  console.log(`        Diagnostic  : ${diagnostic.address}`);

  // ─── Step 4: Register Demo Patient ──────────────────────────────
  console.log("  [4/6] Registering demo patient...");
  const patientRecord = new ethers.Contract(recordAddr, recordABI.abi, patient);
  await patientRecord.registerPatient("QmDemographics_AES256_John_Doe_30M_BloodType_O_Positive");
  console.log("        Patient registered on-chain with encrypted demographics");

  // ─── Step 5: Grant Doctor Access & Add Sample Reports ───────────
  console.log("  [5/6] Setting up demo medical records...");

  // Patient grants doctor access
  await patientRecord.grantAccess(doctor.address);
  console.log(`        Granted doctor access to patient records`);

  // Doctor adds a consultancy report
  const doctorRecord = new ethers.Contract(recordAddr, recordABI.abi, doctor);
  await doctorRecord.addMedicalReport(
    patient.address,
    "QmBloodTest_CBC_WBC_5400_RBC_4_8M_Hgb_14_2_Platelets_250K_Normal",
    "Blood Test"
  );
  console.log("        Added: Blood Test (Complete Blood Count - Normal)");

  await doctorRecord.addMedicalReport(
    patient.address,
    "QmMRIScan_Brain_NoAbnormalities_T1_T2_FLAIR_Sequences_Clear",
    "MRI Scan"
  );
  console.log("        Added: MRI Scan (Brain - No Abnormalities)");

  // Diagnostic center adds a report
  const diagRecord = new ethers.Contract(recordAddr, recordABI.abi, diagnostic);
  await diagRecord.addMedicalReport(
    patient.address,
    "QmXRay_Chest_PA_View_Lungs_Clear_Heart_Normal_Size_No_Fractures",
    "X-Ray"
  );
  console.log("        Added: X-Ray (Chest PA View - Lungs Clear)");

  // ─── Step 6: Save for Frontend ───────────────────────────────────
  console.log("  [6/6] Saving deployment info...");

  const contractsDir = resolve("frontend", "src", "contracts");
  if (!existsSync(contractsDir)) {
    mkdirSync(contractsDir, { recursive: true });
  }

  writeFileSync(
    join(contractsDir, "deployment.json"),
    JSON.stringify({
      network: "localhost",
      contracts: {
        EthSecureHealthAccess: accessAddr,
        EthSecureRecord: recordAddr
      },
      roles: {
        admin: deployer.address,
        doctor: doctor.address,
        patient: patient.address,
        diagnostic: diagnostic.address
      },
      demoData: {
        patientName: "John Doe (Demo)",
        patientAge: 30,
        bloodType: "O+",
        preloadedReports: 3
      },
      deployedAt: new Date().toISOString()
    }, null, 2)
  );

  writeFileSync(
    join(contractsDir, "EthSecureHealthAccess.json"),
    JSON.stringify({ abi: accessABI.abi }, null, 2)
  );
  writeFileSync(
    join(contractsDir, "EthSecureRecord.json"),
    JSON.stringify({ abi: recordABI.abi }, null, 2)
  );

  console.log(`        Saved to: frontend/src/contracts/`);

  // ─── Summary ─────────────────────────────────────────────────────
  console.log("");
  console.log("  ✅ Deployment Complete!");
  console.log("  ─────────────────────────────");
  console.log(`  AccessControl : ${accessAddr}`);
  console.log(`  SecureRecord  : ${recordAddr}`);
  console.log(`  Admin         : ${deployer.address}`);
  console.log(`  Doctor        : ${doctor.address}`);
  console.log(`  Patient       : ${patient.address}`);
  console.log(`  Diagnostic    : ${diagnostic.address}`);
  console.log("");
  console.log("  📋 Demo Data Preloaded:");
  console.log("     • Patient 'John Doe' registered");
  console.log("     • Doctor granted access to patient");
  console.log("     • 3 sample reports: Blood Test, MRI Scan, X-Ray");
  console.log("");
  console.log("  Next: Add these Ganache accounts to MetaMask");
  console.log("  using their private keys from the Ganache terminal.");
  
  await connection.close();
}

main().catch((error) => {
  console.error("Deployment failed:", error.message || error);
  process.exitCode = 1;
});
