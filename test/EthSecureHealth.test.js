import { expect } from "chai";
import hardhat from "hardhat";
const { ethers } = hardhat;

describe("EthSecure Health - Smart Contract Test Suite", function () {
  let accessControl, secureRecord;
  let owner, doctor, doctor2, diagnostic, patient, unauthorized;

  beforeEach(async function () {
    [owner, doctor, doctor2, diagnostic, patient, unauthorized] = await ethers.getSigners();

    // Deploy AccessControl
    const AccessControl = await ethers.getContractFactory("EthSecureHealthAccess");
    accessControl = await AccessControl.deploy();

    // Deploy SecureRecord linked to AccessControl
    const SecureRecord = await ethers.getContractFactory("EthSecureRecord");
    secureRecord = await SecureRecord.deploy(await accessControl.getAddress());

    // Admin assigns roles
    await accessControl.addDoctor(doctor.address);
    await accessControl.addDoctor(doctor2.address);
    await accessControl.addDiagnosticCenter(diagnostic.address);
    await accessControl.addPatient(patient.address);
  });

  // ─── Registration Module ────────────────────────────────────────
  describe("Registration", function () {
    it("Should allow a patient to register with IPFS hash", async function () {
      const ipfsHash = "QmPatientDemographics123";
      await secureRecord.connect(patient).registerPatient(ipfsHash);
      // Success - no revert
    });

    it("Should prevent double registration", async function () {
      const ipfsHash = "QmPatientDemographics123";
      await secureRecord.connect(patient).registerPatient(ipfsHash);
      await expect(
        secureRecord.connect(patient).registerPatient(ipfsHash)
      ).to.be.revertedWith("Already registered");
    });

    it("Should prevent non-patient from registering", async function () {
      await expect(
        secureRecord.connect(unauthorized).registerPatient("QmFakeHash")
      ).to.be.revertedWith("Caller is not a patient");
    });
  });

  // ─── Patient Dashboard - Access Control ─────────────────────────
  describe("Patient Dashboard - Grant & Revoke Access", function () {
    beforeEach(async function () {
      await secureRecord.connect(patient).registerPatient("QmPatientDemo123");
    });

    it("Should allow patient to grant access to a doctor", async function () {
      await secureRecord.connect(patient).grantAccess(doctor.address);
      const hasAccess = await secureRecord.checkAccess(patient.address, doctor.address);
      expect(hasAccess).to.equal(true);
    });

    it("Should allow patient to revoke access from a doctor", async function () {
      await secureRecord.connect(patient).grantAccess(doctor.address);
      await secureRecord.connect(patient).revokeAccess(doctor.address);
      const hasAccess = await secureRecord.checkAccess(patient.address, doctor.address);
      expect(hasAccess).to.equal(false);
    });

    it("Should prevent granting access to a non-doctor address", async function () {
      await expect(
        secureRecord.connect(patient).grantAccess(unauthorized.address)
      ).to.be.revertedWith("Target is not a doctor");
    });

    it("Should prevent revoking access from a doctor who has no access", async function () {
      await expect(
        secureRecord.connect(patient).revokeAccess(doctor.address)
      ).to.be.revertedWith("Doctor does not have access");
    });
  });

  // ─── Doctor Dashboard - Medical Reports ─────────────────────────
  describe("Doctor Dashboard - Viewing Reports", function () {
    beforeEach(async function () {
      await secureRecord.connect(patient).registerPatient("QmPatientDemo123");
      await secureRecord.connect(patient).grantAccess(doctor.address);
    });

    it("Should allow authorized doctor to add a medical report", async function () {
      await secureRecord.connect(doctor).addMedicalReport(
        patient.address, "QmMRIScan456", "MRI Scan"
      );
      const reports = await secureRecord.connect(doctor).getPatientMedicalReports(patient.address);
      expect(reports.length).to.equal(1);
      expect(reports[0].ipfsHash).to.equal("QmMRIScan456");
      expect(reports[0].reportType).to.equal("MRI Scan");
    });

    it("Should allow diagnostic center to add a report without explicit patient grant", async function () {
      await secureRecord.connect(diagnostic).addMedicalReport(
        patient.address, "QmBloodWork789", "Blood Test"
      );
      const reports = await secureRecord.connect(patient).getPatientMedicalReports(patient.address);
      expect(reports.length).to.equal(1);
      expect(reports[0].reportType).to.equal("Blood Test");
    });

    it("Should prevent unauthorized doctor from adding a report", async function () {
      // doctor2 was NOT granted access by patient
      await expect(
        secureRecord.connect(doctor2).addMedicalReport(patient.address, "QmFake", "X-Ray")
      ).to.be.revertedWith("Not authorized to add report for this patient");
    });

    it("Should prevent unauthorized doctor from viewing reports", async function () {
      await expect(
        secureRecord.connect(doctor2).getPatientMedicalReports(patient.address)
      ).to.be.revertedWith("Doctor does not have access");
    });

    it("Should allow patient to view their own reports", async function () {
      await secureRecord.connect(doctor).addMedicalReport(
        patient.address, "QmReport1", "Blood Test"
      );
      const reports = await secureRecord.connect(patient).getPatientMedicalReports(patient.address);
      expect(reports.length).to.equal(1);
    });

    it("Should allow patient to upload their own prescription", async function () {
      await secureRecord.connect(patient).addMedicalReport(
        patient.address, "QmSelfUploadedPrescription", "Prescription"
      );
      const reports = await secureRecord.connect(patient).getPatientMedicalReports(patient.address);
      expect(reports.length).to.equal(1);
      expect(reports[0].uploadedBy).to.equal(patient.address);
      expect(reports[0].reportType).to.equal("Prescription");
    });

    it("Should block non-doctor non-patient account from viewing records", async function () {
      await expect(
        secureRecord.connect(unauthorized).getPatientMedicalReports(patient.address)
      ).to.be.revertedWith("Only patient or doctor can view records");
    });
  });

  // ─── Revoking Permissions - Security ────────────────────────────
  describe("Revoking Permissions", function () {
    beforeEach(async function () {
      await secureRecord.connect(patient).registerPatient("QmPatientDemo123");
      await secureRecord.connect(patient).grantAccess(doctor.address);
      await secureRecord.connect(doctor).addMedicalReport(
        patient.address, "QmReport1", "MRI Scan"
      );
    });

    it("Should block doctor from viewing after access is revoked", async function () {
      // Doctor CAN view before revocation
      const reportsBefore = await secureRecord.connect(doctor).getPatientMedicalReports(patient.address);
      expect(reportsBefore.length).to.equal(1);

      // Patient revokes
      await secureRecord.connect(patient).revokeAccess(doctor.address);

      // Doctor CANNOT view after revocation
      await expect(
        secureRecord.connect(doctor).getPatientMedicalReports(patient.address)
      ).to.be.revertedWith("Doctor does not have access");
    });

    it("Should block doctor from adding reports after access is revoked", async function () {
      await secureRecord.connect(patient).revokeAccess(doctor.address);
      await expect(
        secureRecord.connect(doctor).addMedicalReport(patient.address, "QmNewReport", "X-Ray")
      ).to.be.revertedWith("Not authorized to add report for this patient");
    });
  });

  // ─── Emergency Metadata ────────────────────────────────────────
  describe("Emergency Metadata", function () {
    beforeEach(async function () {
      await secureRecord.connect(patient).registerPatient("QmPatientDemo123");
    });

    it("Should allow patient to set emergency metadata", async function () {
      const tx = await secureRecord.connect(patient).setEmergencyMetadata("O+", "Jane Doe: +91-9999999999");
      await tx.wait();
      const [bloodType, emergencyContact, updatedAt] = await secureRecord.getEmergencyMetadata(patient.address);
      expect(bloodType).to.equal("O+");
      expect(emergencyContact).to.equal("Jane Doe: +91-9999999999");
      expect(updatedAt).to.be.gt(0n);
    });

    it("Should allow any caller to read emergency metadata for registered patient", async function () {
      await secureRecord.connect(patient).setEmergencyMetadata("AB-", "John Emergency: +91-8888888888");
      const [bloodType, emergencyContact] = await secureRecord.connect(doctor2).getEmergencyMetadata(patient.address);
      expect(bloodType).to.equal("AB-");
      expect(emergencyContact).to.equal("John Emergency: +91-8888888888");
    });
  });
});
