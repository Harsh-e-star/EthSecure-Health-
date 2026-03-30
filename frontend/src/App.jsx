import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import './index.css';
import deploymentData from './contracts/deployment.json';
import AccessControlABI from './contracts/EthSecureHealthAccess.json';
import SecureRecordABI from './contracts/EthSecureRecord.json';

// ─── Utility Helpers ───────────────────────────────────────
const hashPassword = async (pw) => {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
};

const saveProfile = (wallet, data) => localStorage.setItem(`esh_profile_${wallet.toLowerCase()}`, JSON.stringify(data));
const loadProfile = (wallet) => { try { return JSON.parse(localStorage.getItem(`esh_profile_${wallet.toLowerCase()}`)); } catch { return null; } };
const saveFile = (key, base64) => localStorage.setItem(`esh_file_${key}`, base64);
const loadFile = (key) => localStorage.getItem(`esh_file_${key}`);
const genCID = () => 'Qm' + Array.from(crypto.getRandomValues(new Uint8Array(22))).map(b => b.toString(36)).join('').substring(0, 34);
const genUniqueID = (role) => {
  const prefix = role === 'patient' ? 'PAT' : 'DOC';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(6))).map(b => chars[b % chars.length]).join('');
  return `${prefix}-${rand}`;
};

function App() {
  // ─── Core State ─────────────────────────────────────────
  const [view, setView] = useState('landing');
  const [account, setAccount] = useState('');
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [accessContract, setAccessContract] = useState(null);
  const [recordContract, setRecordContract] = useState(null);
  const [status, setStatus] = useState({ msg: '', type: '' });
  const [loading, setLoading] = useState(false);
  const [dashTab, setDashTab] = useState('profile');
  const [userRole, setUserRole] = useState('');

  // ─── Registration Form State ────────────────────────────
  const [regForm, setRegForm] = useState({
    fullName: '', dob: '', gender: '', bloodType: '', phone: '', email: '',
    street: '', city: '', state: '', emergencyName: '', emergencyPhone: '',
    uniqueId: '', password: '', confirmPassword: '',
    // Doctor-specific
    specialization: '', hospital: '', licenseNo: '', experience: '', languages: ''
  });

  // ─── Login State ────────────────────────────────────────
  const [loginForm, setLoginForm] = useState({ uniqueId: '', password: '' });

  // ─── Patient Dashboard State ────────────────────────────
  const [myReports, setMyReports] = useState([]);
  const [authorizedDocs, setAuthorizedDocs] = useState([]);
  const [doctorAddr, setDoctorAddr] = useState('');
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadMeta, setUploadMeta] = useState({ doctorName: '', date: '', medication: '', notes: '' });

  // ─── Doctor Dashboard State ─────────────────────────────
  const [searchPatientAddr, setSearchPatientAddr] = useState('');
  const [patientReports, setPatientReports] = useState([]);
  const [docReportFile, setDocReportFile] = useState(null);
  const [docReportMeta, setDocReportMeta] = useState({ patientAddr: '', type: 'Blood Test', notes: '' });

  // ─── Document Viewer State ───────────────────────────────
  const [viewingDoc, setViewingDoc] = useState(null);

  // ─── Show Status ────────────────────────────────────────
  const flash = (msg, type = 'info') => setStatus({ msg, type });
  const clearStatus = () => setStatus({ msg: '', type: '' });

  // ─── MetaMask Connection ────────────────────────────────
  // intent: 'register' | 'login' | 'auto'
  const connectMetaMask = async (intent = 'auto') => {
    if (!window.ethereum) { flash('Please install MetaMask to continue!', 'error'); return; }
    try {
      setLoading(true);
      const prov = new ethers.BrowserProvider(window.ethereum);
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const sig = await prov.getSigner();
      const addr = await sig.getAddress();

      const access = new ethers.Contract(deploymentData.contracts.EthSecureHealthAccess, AccessControlABI.abi, sig);
      const record = new ethers.Contract(deploymentData.contracts.EthSecureRecord, SecureRecordABI.abi, sig);

      setProvider(prov); setSigner(sig); setAccount(addr);
      setAccessContract(access); setRecordContract(record);

      const existingProfile = loadProfile(addr);

      if (intent === 'login') {
        if (existingProfile) {
          setView('login');
          setUserRole(existingProfile.role);
          flash('Welcome back! Please enter your credentials.', 'info');
        } else {
          flash('No account found for this wallet. Redirecting to registration.', 'warning');
          setView('role-select');
        }
      } else if (intent === 'register') {
        if (existingProfile) {
          flash('An account already exists for this wallet. Redirecting to login.', 'info');
          setView('login');
          setUserRole(existingProfile.role);
        } else {
          setView('role-select');
          flash(`Wallet connected: ${addr.substring(0, 8)}...${addr.substring(38)}`, 'success');
        }
      } else {
        // auto: preserve original behaviour
        if (existingProfile) {
          setView('login');
          setUserRole(existingProfile.role);
          flash('Welcome back! Please login.', 'info');
        } else {
          setView('role-select');
          flash(`Connected: ${addr.substring(0, 8)}...${addr.substring(38)}`, 'success');
        }
      }

      window.ethereum.on('accountsChanged', (accounts) => {
        if (accounts.length > 0) { window.location.reload(); }
        else { setAccount(''); setView('landing'); }
      });
    } catch (err) {
      flash('Connection failed: ' + (err.message || 'Unknown error'), 'error');
    } finally { setLoading(false); }
  };

  // ─── Registration ───────────────────────────────────────
  const handleRegister = async (role) => {
    const f = regForm;
    if (!f.fullName || !f.password) { flash('Please fill all required fields.', 'error'); return; }
    if (f.password !== f.confirmPassword) { flash('Passwords do not match!', 'error'); return; }
    if (f.password.length < 6) { flash('Password must be at least 6 characters.', 'error'); return; }

    try {
      setLoading(true);
      flash('⏳ Registering on blockchain...', 'info');

      // Self-register role on-chain
      if (role === 'patient') {
        const tx = await accessContract.selfRegisterAsPatient();
        await tx.wait();
        // Also register patient in record contract
        const cid = genCID();
        const tx2 = await recordContract.registerPatient(cid);
        await tx2.wait();
      } else {
        const tx = await accessContract.selfRegisterAsDoctor();
        await tx.wait();
      }

      // Save profile locally
      const uniqueId = genUniqueID(role);
      const pwHash = await hashPassword(f.password);
      const profile = { ...f, uniqueId, role, passwordHash: pwHash, wallet: account, createdAt: new Date().toISOString() };
      delete profile.password;
      delete profile.confirmPassword;
      saveProfile(account, profile);

      setUserRole(role);
      setDashTab('profile');
      setView(role === 'patient' ? 'patient-dash' : 'doctor-dash');
      flash(`✅ Registered! Your Unique ID: ${uniqueId} — save it for login!`, 'success');
    } catch (err) {
      flash('Registration failed: ' + (err.reason || err.message || 'Unknown error'), 'error');
    } finally { setLoading(false); }
  };

  // ─── Login ──────────────────────────────────────────────
  const handleLogin = async () => {
    const profile = loadProfile(account);
    if (!profile) { flash('No account found. Please register first.', 'error'); return; }
    if (loginForm.uniqueId !== profile.uniqueId) { flash('Invalid Unique ID.', 'error'); return; }
    const pwHash = await hashPassword(loginForm.password);
    if (pwHash !== profile.passwordHash) { flash('Incorrect password.', 'error'); return; }

    setUserRole(profile.role);
    setRegForm(profile);
    setDashTab('profile');
    setView(profile.role === 'patient' ? 'patient-dash' : 'doctor-dash');
    flash(`Welcome back, ${profile.fullName}!`, 'success');
  };

  // ─── Logout ─────────────────────────────────────────────
  const handleLogout = () => {
    setView('landing');
    setUserRole('');
    setDashTab('profile');
    setMyReports([]);
    setAuthorizedDocs([]);
    setPatientReports([]);
    clearStatus();
  };

  // ─── Patient: View My Reports ───────────────────────────
  const fetchMyReports = async () => {
    try {
      setLoading(true);
      const reports = await recordContract.getPatientMedicalReports(account);
      const parsed = reports.map(r => ({
        id: Number(r.id), ipfsHash: r.ipfsHash, uploadedBy: r.uploadedBy,
        timestamp: new Date(Number(r.timestamp) * 1000).toLocaleString(), reportType: r.reportType
      }));
      setMyReports(parsed);
      flash(`Found ${parsed.length} report(s)`, 'success');
    } catch (err) {
      flash('Failed to fetch reports: ' + (err.reason || err.message), 'error');
    } finally { setLoading(false); }
  };

  // ─── Patient: Grant Access ──────────────────────────────
  const grantAccess = async () => {
    if (!doctorAddr) { flash('Enter a doctor address.', 'error'); return; }
    try {
      setLoading(true);
      const tx = await recordContract.grantAccess(doctorAddr);
      await tx.wait();
      flash(`✅ Access granted to ${doctorAddr.substring(0, 10)}...`, 'success');
      setDoctorAddr('');
      await refreshDoctors();
    } catch (err) { flash('Grant failed: ' + (err.reason || err.message), 'error'); }
    finally { setLoading(false); }
  };

  // ─── Patient: Revoke Access ─────────────────────────────
  const revokeAccess = async (doc) => {
    try {
      setLoading(true);
      const tx = await recordContract.revokeAccess(doc);
      await tx.wait();
      flash(`🚫 Access revoked.`, 'success');
      await refreshDoctors();
    } catch (err) { flash('Revoke failed: ' + (err.reason || err.message), 'error'); }
    finally { setLoading(false); }
  };

  const refreshDoctors = async () => {
    try {
      const docs = await recordContract.getAuthorizedDoctors(account);
      const active = [];
      for (const doc of docs) { if (await recordContract.checkAccess(account, doc)) active.push(doc); }
      setAuthorizedDocs(active);
    } catch { setAuthorizedDocs([]); }
  };

  // ─── Patient: Upload Prescription ───────────────────────
  const uploadPrescription = async () => {
    if (!uploadFile) { flash('Select a file first.', 'error'); return; }
    try {
      setLoading(true);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const cid = genCID();
        saveFile(cid, e.target.result);
        const tx = await recordContract.addMedicalReport(account, cid, 'Prescription');
        await tx.wait();
        flash(`✅ Prescription uploaded! CID: ${cid.substring(0, 16)}...`, 'success');
        setUploadFile(null);
        setUploadMeta({ doctorName: '', date: '', medication: '', notes: '' });
        await fetchMyReports();
      };
      reader.readAsDataURL(uploadFile);
    } catch (err) { flash('Upload failed: ' + (err.reason || err.message), 'error'); }
    finally { setLoading(false); }
  };

  // ─── Doctor: View Patient Reports ───────────────────────
  const fetchPatientReports = async () => {
    if (!searchPatientAddr) { flash('Enter a patient address.', 'error'); return; }
    try {
      setLoading(true);
      const reports = await recordContract.getPatientMedicalReports(searchPatientAddr);
      const parsed = reports.map(r => ({
        id: Number(r.id), ipfsHash: r.ipfsHash, uploadedBy: r.uploadedBy,
        timestamp: new Date(Number(r.timestamp) * 1000).toLocaleString(), reportType: r.reportType
      }));
      setPatientReports(parsed);
      flash(`Found ${parsed.length} report(s) for patient.`, 'success');
    } catch (err) { flash('Access denied or error: ' + (err.reason || err.message), 'error'); }
    finally { setLoading(false); }
  };

  // ─── Doctor: Add Report ─────────────────────────────────
  const addDoctorReport = async () => {
    if (!docReportMeta.patientAddr) { flash('Enter patient address.', 'error'); return; }
    try {
      setLoading(true);
      let cid = genCID();
      if (docReportFile) {
        const b64 = await new Promise((res) => { const r = new FileReader(); r.onload = e => res(e.target.result); r.readAsDataURL(docReportFile); });
        saveFile(cid, b64);
      }
      const tx = await recordContract.addMedicalReport(docReportMeta.patientAddr, cid, docReportMeta.type);
      await tx.wait();
      flash(`✅ Report submitted!`, 'success');
      setDocReportFile(null);
      setDocReportMeta({ patientAddr: '', type: 'Blood Test', notes: '' });
    } catch (err) { flash('Submit failed: ' + (err.reason || err.message), 'error'); }
    finally { setLoading(false); }
  };

  // ─── Profile helper ─────────────────────────────────────
  const profile = loadProfile(account);
  const shortAddr = account ? `${account.substring(0, 6)}...${account.substring(38)}` : '';

  // ─── Document Viewer ────────────────────────────────────
  const reportTypeIcon = (type) => {
    const icons = { 'Prescription': '💊', 'Blood Test': '🩸', 'MRI Scan': '🧠', 'X-Ray': '🦴',
      'CT Scan': '🔬', 'Ultrasound': '📡', 'ECG': '💓', 'Consultancy Report': '📝' };
    return icons[type] || '📄';
  };

  const openDocument = (ipfsHash, reportType) => {
    const file = loadFile(ipfsHash);
    if (!file) { flash('File content not available locally (may be stored on IPFS only).', 'warning'); return; }
    setViewingDoc({ file, reportType, cid: ipfsHash });
  };

  const downloadDocument = (ipfsHash, reportType) => {
    const file = loadFile(ipfsHash);
    if (!file) { flash('File not available for download.', 'warning'); return; }
    let ext = 'bin';
    if (file.startsWith('data:image/png')) ext = 'png';
    else if (file.startsWith('data:image/jpeg')) ext = 'jpg';
    else if (file.startsWith('data:application/pdf')) ext = 'pdf';
    const link = document.createElement('a');
    link.href = file;
    link.download = `${reportType.replace(/\s+/g, '_')}_${ipfsHash.substring(0, 8)}.${ext}`;
    link.click();
  };

  // ═══════════════════════════════════════════════════════
  //  RENDER HELPERS
  // ═══════════════════════════════════════════════════════

  const StatusBar = () => status.msg ? (
    <div style={{ maxWidth: 900, margin: '16px auto', padding: '0 24px' }}>
      <div className={`status-bar status-${status.type}`}>
        <span>{status.msg}</span>
        <button onClick={clearStatus} style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: '1rem' }}>✕</button>
      </div>
    </div>
  ) : null;

  const Navbar = () => (
    <nav className="navbar">
      <div className="navbar-logo" onClick={() => { if (view.includes('dash')) return; setView('landing'); }}>
        <div className="navbar-logo-icon">E<span style={{ fontSize: '0.65em' }}>SH</span></div>
        <span className="navbar-title gradient-text">EthSecure Health</span>
      </div>
      <div className="navbar-actions">
        {account && view.includes('dash') && (
          <>
            <span className="badge badge-brand">{shortAddr}</span>
            <button className="btn btn-ghost btn-sm" onClick={handleLogout}>Logout</button>
          </>
        )}
      </div>
    </nav>
  );

  const Footer = () => (
    <footer className="footer">
      © 2026 EthSecure Health — Powered by Ethereum & IPFS | Blockchain-secured medical records
    </footer>
  );

  const DocumentModal = () => {
    if (!viewingDoc) return null;
    const isImage = viewingDoc.file.startsWith('data:image');
    const isPDF = viewingDoc.file.startsWith('data:application/pdf');
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.82)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}
        onClick={() => setViewingDoc(null)}>
        <div className="glass-static" style={{ maxWidth: 860, width: '100%', maxHeight: '88vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
          onClick={e => e.stopPropagation()}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
              <span style={{ fontSize: '1.4rem' }}>{reportTypeIcon(viewingDoc.reportType)}</span>
              <span className="badge badge-brand">{viewingDoc.reportType}</span>
              <span style={{ color: 'var(--text-faint)', fontSize: '0.78rem', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 220 }}>
                {viewingDoc.cid}
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => downloadDocument(viewingDoc.cid, viewingDoc.reportType)}>⬇️ Download</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setViewingDoc(null)}>✕ Close</button>
            </div>
          </div>
          {/* Body */}
          <div style={{ flex: 1, overflow: 'auto', padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.3)' }}>
            {isImage && (
              <img src={viewingDoc.file} alt={viewingDoc.reportType}
                style={{ maxWidth: '100%', maxHeight: '65vh', objectFit: 'contain', borderRadius: 'var(--radius-md)' }} />
            )}
            {isPDF && (
              <iframe src={viewingDoc.file} title={viewingDoc.reportType}
                style={{ width: '100%', height: '65vh', border: 'none', borderRadius: 'var(--radius-md)', background: 'white' }} />
            )}
            {!isImage && !isPDF && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                <div style={{ fontSize: '4rem', marginBottom: 16 }}>📄</div>
                <p style={{ marginBottom: 8, fontWeight: 600 }}>Preview unavailable for this file type</p>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-faint)', marginBottom: 20 }}>Use the download button to open it in your device.</p>
                <button className="btn btn-brand" onClick={() => downloadDocument(viewingDoc.cid, viewingDoc.reportType)}>⬇️ Download File</button>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ═══════════════════════════════════════════════════════
  //  VIEWS
  // ═══════════════════════════════════════════════════════

  return (
    <>
      <div className="orb orb-1" />
      <div className="orb orb-2" />
      <div className="orb orb-3" />
      <DocumentModal />
      <Navbar />
      <StatusBar />

      <main style={{ flex: 1, position: 'relative', zIndex: 1 }}>

        {/* ════════ LANDING ════════ */}
        {view === 'landing' && (
          <div className="animate-fade" style={{ maxWidth: 1000, margin: '0 auto', padding: '80px 24px', textAlign: 'center' }}>
            <div className="animate-float" style={{ fontSize: '4rem', marginBottom: 24 }}>🏥</div>
            <h1 style={{ fontSize: '3.2rem', fontWeight: 900, letterSpacing: '-0.03em', lineHeight: 1.1, marginBottom: 20 }}>
              Secure Health Records<br /><span className="gradient-text">on the Blockchain.</span>
            </h1>
            <p style={{ fontSize: '1.15rem', color: 'var(--text-secondary)', maxWidth: 600, margin: '0 auto 40px', lineHeight: 1.7 }}>
              Your medical data, encrypted & decentralized. Only you control who sees it. Powered by Ethereum, MetaMask, and IPFS.
            </p>

            {/* ── Primary CTA: Register / Login ── */}
            <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 14 }}>
              <button className="btn btn-brand btn-lg animate-pulse-glow" onClick={() => connectMetaMask('register')} disabled={loading} style={{ minWidth: 220 }}>
                {loading ? <><span className="spinner" /> Connecting...</> : <>📝 Register — New User</>}
              </button>
              <button className="btn btn-ghost btn-lg" onClick={() => connectMetaMask('login')} disabled={loading}
                style={{ minWidth: 220, borderColor: 'var(--border-active)', color: 'var(--brand-light)' }}>
                {loading ? <><span className="spinner" /> Connecting...</> : <>🔑 Login — Returning User</>}
              </button>
            </div>
            <p style={{ color: 'var(--text-faint)', fontSize: '0.82rem', marginBottom: 70 }}>🦊 Requires MetaMask browser extension</p>

            <div className="grid-3 stagger" style={{ textAlign: 'left' }}>
              {[
                { icon: '🔐', title: 'End-to-End Encrypted', desc: 'AES-256 encryption before IPFS upload. Your keys never leave your browser.' },
                { icon: '⛓️', title: 'Blockchain Auditable', desc: 'Every access, grant, and upload is permanently recorded on-chain.' },
                { icon: '👨‍⚕️', title: 'Doctor Access Control', desc: 'Grant and revoke doctor access to your records with one click.' }
              ].map((f, i) => (
                <div key={i} className="glass animate-fade" style={{ padding: 32 }}>
                  <div style={{ fontSize: '2rem', marginBottom: 12 }}>{f.icon}</div>
                  <h3 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 8 }}>{f.title}</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════ ROLE SELECT ════════ */}
        {view === 'role-select' && (
          <div className="animate-fade" style={{ maxWidth: 700, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 8 }}>Choose Your Role</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 40 }}>Connected: <span className="mono" style={{ color: 'var(--brand-light)' }}>{shortAddr}</span></p>
            <div className="grid-2">
              {[
                { role: 'patient', icon: '🏥', title: 'I\'m a Patient', desc: 'Register, manage records, upload prescriptions, control doctor access.', color: 'brand' },
                { role: 'doctor', icon: '👨‍⚕️', title: 'I\'m a Doctor', desc: 'View patient records, add reports, manage your practice.', color: 'accent' }
              ].map(r => (
                <button key={r.role} className="glass" onClick={() => { setUserRole(r.role); setView(`register-${r.role}`); }}
                  style={{ padding: 40, cursor: 'pointer', textAlign: 'left', transition: 'all 0.3s' }}>
                  <div style={{ fontSize: '3rem', marginBottom: 16 }}>{r.icon}</div>
                  <h3 style={{ fontSize: '1.3rem', fontWeight: 700, marginBottom: 8 }}>{r.title}</h3>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{r.desc}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ════════ LOGIN ════════ */}
        {view === 'login' && (
          <div className="animate-fade" style={{ maxWidth: 440, margin: '0 auto', padding: '60px 24px' }}>
            <div style={{ textAlign: 'center', marginBottom: 32 }}>
              <div style={{ fontSize: '3rem', marginBottom: 12 }}>🔑</div>
              <h2 style={{ fontSize: '1.8rem', fontWeight: 800, marginBottom: 8 }}>Welcome Back</h2>
              <p style={{ color: 'var(--text-secondary)' }}>Login to your <span className="badge badge-brand">{userRole}</span> account</p>
            </div>
            <div className="glass" style={{ padding: 32 }}>
              <div style={{ marginBottom: 16 }}>
                <label className="label">Unique ID</label>
                <input className="input" placeholder="e.g. PAT-A7X3K9 or DOC-B2M5R1" value={loginForm.uniqueId} onChange={e => setLoginForm({ ...loginForm, uniqueId: e.target.value })} />
              </div>
              <div style={{ marginBottom: 24 }}>
                <label className="label">Password</label>
                <input className="input" type="password" placeholder="Enter password" value={loginForm.password} onChange={e => setLoginForm({ ...loginForm, password: e.target.value })}
                  onKeyDown={e => e.key === 'Enter' && handleLogin()} />
              </div>
              <button className="btn btn-brand btn-full" onClick={handleLogin} disabled={loading}>
                {loading ? <><span className="spinner" /> Logging in...</> : 'Login'}
              </button>
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '0.85rem' }}
                  onClick={() => setView('role-select')}>Don't have an account? Register</button>
              </div>
            </div>
          </div>
        )}

        {/* ════════ PATIENT REGISTRATION ════════ */}
        {view === 'register-patient' && (
          <div className="animate-fade" style={{ maxWidth: 700, margin: '0 auto', padding: '40px 24px' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 4 }}>🏥 Patient Registration</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Fill in your details to create an account on the blockchain.</p>
            <div className="glass" style={{ padding: 32 }}>
              <h3 style={{ fontWeight: 700, marginBottom: 16, color: 'var(--brand-light)' }}>Personal Information</h3>
              <div className="grid-2">
                <div><label className="label">Full Name *</label><input className="input" placeholder="John Doe" value={regForm.fullName} onChange={e => setRegForm({ ...regForm, fullName: e.target.value })} /></div>
                <div><label className="label">Date of Birth</label><input className="input" type="date" value={regForm.dob} onChange={e => setRegForm({ ...regForm, dob: e.target.value })} /></div>
                <div><label className="label">Gender</label><select className="input" value={regForm.gender} onChange={e => setRegForm({ ...regForm, gender: e.target.value })}><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></div>
                <div><label className="label">Blood Type</label><select className="input" value={regForm.bloodType} onChange={e => setRegForm({ ...regForm, bloodType: e.target.value })}><option value="">Select</option><option>A+</option><option>A-</option><option>B+</option><option>B-</option><option>AB+</option><option>AB-</option><option>O+</option><option>O-</option></select></div>
                <div><label className="label">Phone</label><input className="input" placeholder="+91 98765 43210" value={regForm.phone} onChange={e => setRegForm({ ...regForm, phone: e.target.value })} /></div>
                <div><label className="label">Email</label><input className="input" type="email" placeholder="john@example.com" value={regForm.email} onChange={e => setRegForm({ ...regForm, email: e.target.value })} /></div>
              </div>
              <div className="divider" />
              <h3 style={{ fontWeight: 700, marginBottom: 16, color: 'var(--brand-light)' }}>Address</h3>
              <div className="grid-3">
                <div><label className="label">Street</label><input className="input" value={regForm.street} onChange={e => setRegForm({ ...regForm, street: e.target.value })} /></div>
                <div><label className="label">City</label><input className="input" value={regForm.city} onChange={e => setRegForm({ ...regForm, city: e.target.value })} /></div>
                <div><label className="label">State</label><input className="input" value={regForm.state} onChange={e => setRegForm({ ...regForm, state: e.target.value })} /></div>
              </div>
              <div className="divider" />
              <h3 style={{ fontWeight: 700, marginBottom: 16, color: 'var(--brand-light)' }}>Emergency Contact</h3>
              <div className="grid-2">
                <div><label className="label">Contact Name</label><input className="input" value={regForm.emergencyName} onChange={e => setRegForm({ ...regForm, emergencyName: e.target.value })} /></div>
                <div><label className="label">Contact Phone</label><input className="input" value={regForm.emergencyPhone} onChange={e => setRegForm({ ...regForm, emergencyPhone: e.target.value })} /></div>
              </div>
              <div className="divider" />
              <h3 style={{ fontWeight: 700, marginBottom: 16, color: 'var(--brand-light)' }}>Account Credentials</h3>
              <div className="grid-2">
                <div><label className="label">Unique ID</label><input className="input" value="Auto-generated on registration" disabled style={{ opacity: 0.6 }} /></div>
                <div style={{ gridColumn: 'span 2' }}></div>
                <div><label className="label">Password *</label><input className="input" type="password" placeholder="Min 6 characters" value={regForm.password} onChange={e => setRegForm({ ...regForm, password: e.target.value })} /></div>
                <div><label className="label">Confirm Password *</label><input className="input" type="password" placeholder="Re-enter password" value={regForm.confirmPassword} onChange={e => setRegForm({ ...regForm, confirmPassword: e.target.value })} /></div>
              </div>
              <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
                <button className="btn btn-brand btn-lg" onClick={() => handleRegister('patient')} disabled={loading}>
                  {loading ? <><span className="spinner" /> Registering...</> : '📝 Register as Patient'}
                </button>
                <button className="btn btn-ghost" onClick={() => setView('role-select')}>Back</button>
              </div>
            </div>
          </div>
        )}

        {/* ════════ DOCTOR REGISTRATION ════════ */}
        {view === 'register-doctor' && (
          <div className="animate-fade" style={{ maxWidth: 700, margin: '0 auto', padding: '40px 24px' }}>
            <h2 style={{ fontSize: '2rem', fontWeight: 800, marginBottom: 4 }}>👨‍⚕️ Doctor Registration</h2>
            <p style={{ color: 'var(--text-secondary)', marginBottom: 32 }}>Register your medical practice on the blockchain.</p>
            <div className="glass" style={{ padding: 32 }}>
              <h3 style={{ fontWeight: 700, marginBottom: 16, color: 'var(--accent-light)' }}>Personal Information</h3>
              <div className="grid-2">
                <div><label className="label">Full Name *</label><input className="input" placeholder="Dr. Jane Smith" value={regForm.fullName} onChange={e => setRegForm({ ...regForm, fullName: e.target.value })} /></div>
                <div><label className="label">Phone</label><input className="input" placeholder="+91 98765 43210" value={regForm.phone} onChange={e => setRegForm({ ...regForm, phone: e.target.value })} /></div>
                <div><label className="label">Email</label><input className="input" type="email" placeholder="dr.jane@hospital.com" value={regForm.email} onChange={e => setRegForm({ ...regForm, email: e.target.value })} /></div>
                <div><label className="label">Gender</label><select className="input" value={regForm.gender} onChange={e => setRegForm({ ...regForm, gender: e.target.value })}><option value="">Select</option><option>Male</option><option>Female</option><option>Other</option></select></div>
              </div>
              <div className="divider" />
              <h3 style={{ fontWeight: 700, marginBottom: 16, color: 'var(--accent-light)' }}>Professional Details</h3>
              <div className="grid-2">
                <div><label className="label">Specialization *</label><select className="input" value={regForm.specialization} onChange={e => setRegForm({ ...regForm, specialization: e.target.value })}><option value="">Select</option><option>General Medicine</option><option>Cardiology</option><option>Neurology</option><option>Orthopedics</option><option>Dermatology</option><option>Pediatrics</option><option>Oncology</option><option>Radiology</option><option>Psychiatry</option><option>Surgery</option></select></div>
                <div><label className="label">Hospital / Clinic</label><input className="input" placeholder="City Hospital" value={regForm.hospital} onChange={e => setRegForm({ ...regForm, hospital: e.target.value })} /></div>
                <div><label className="label">License No.</label><input className="input" placeholder="MED-XXXXX" value={regForm.licenseNo} onChange={e => setRegForm({ ...regForm, licenseNo: e.target.value })} /></div>
                <div><label className="label">Years of Experience</label><input className="input" type="number" min="0" value={regForm.experience} onChange={e => setRegForm({ ...regForm, experience: e.target.value })} /></div>
                <div><label className="label">Languages Spoken</label><input className="input" placeholder="English, Hindi" value={regForm.languages} onChange={e => setRegForm({ ...regForm, languages: e.target.value })} /></div>
              </div>
              <div className="divider" />
              <h3 style={{ fontWeight: 700, marginBottom: 16, color: 'var(--accent-light)' }}>Account Credentials</h3>
              <div className="grid-2">
                <div><label className="label">Unique ID</label><input className="input" value="Auto-generated on registration" disabled style={{ opacity: 0.6 }} /></div>
                <div style={{ gridColumn: 'span 2' }}></div>
                <div><label className="label">Password *</label><input className="input" type="password" placeholder="Min 6 characters" value={regForm.password} onChange={e => setRegForm({ ...regForm, password: e.target.value })} /></div>
                <div><label className="label">Confirm Password *</label><input className="input" type="password" placeholder="Re-enter password" value={regForm.confirmPassword} onChange={e => setRegForm({ ...regForm, confirmPassword: e.target.value })} /></div>
              </div>
              <div style={{ marginTop: 28, display: 'flex', gap: 12 }}>
                <button className="btn btn-accent btn-lg" onClick={() => handleRegister('doctor')} disabled={loading}>
                  {loading ? <><span className="spinner" /> Registering...</> : '📝 Register as Doctor'}
                </button>
                <button className="btn btn-ghost" onClick={() => setView('role-select')}>Back</button>
              </div>
            </div>
          </div>
        )}

        {/* ════════ PATIENT DASHBOARD ════════ */}
        {view === 'patient-dash' && profile && (
          <div className="animate-fade" style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div className="avatar avatar-brand">{profile.fullName?.charAt(0)?.toUpperCase()}</div>
              <div>
                <h2 style={{ fontSize: '1.6rem', fontWeight: 800 }}>{profile.fullName}</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }} className="mono">{account}</p>
              </div>
            </div>
            <div className="tabs" style={{ marginBottom: 24 }}>
              {['profile', 'upload', 'records', 'access'].map(t => (
                <button key={t} className={`tab ${dashTab === t ? 'tab-active' : ''}`} onClick={() => { setDashTab(t); if (t === 'records') fetchMyReports(); if (t === 'access') refreshDoctors(); }}>
                  {{ profile: '👤 Profile', upload: '📤 Upload Rx', records: '📋 Records', access: '🔐 Access' }[t]}
                </button>
              ))}
            </div>

            {/* Profile Tab */}
            {dashTab === 'profile' && (
              <div className="glass" style={{ padding: 32 }}>
                <h3 style={{ fontWeight: 700, marginBottom: 20, color: 'var(--brand-light)' }}>Your Profile</h3>
                <div className="grid-3">
                  {[
                    ['Full Name', profile.fullName], ['Date of Birth', profile.dob || '—'], ['Gender', profile.gender || '—'],
                    ['Blood Type', profile.bloodType || '—'], ['Phone', profile.phone || '—'], ['Email', profile.email || '—'],
                    ['City', profile.city || '—'], ['State', profile.state || '—'], ['Emergency Contact', profile.emergencyName || '—']
                  ].map(([label, val], i) => (
                    <div key={i}><span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.04em' }}>{label}</span><p style={{ fontWeight: 600, marginTop: 4 }}>{val}</p></div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload Prescription Tab */}
            {dashTab === 'upload' && (
              <div className="glass" style={{ padding: 32 }}>
                <h3 style={{ fontWeight: 700, marginBottom: 20, color: 'var(--brand-light)' }}>Upload Prescription</h3>
                <div className="upload-zone" onClick={() => document.getElementById('rx-file').click()} onDragOver={e => { e.preventDefault(); e.currentTarget.classList.add('drag-over'); }} onDragLeave={e => e.currentTarget.classList.remove('drag-over')} onDrop={e => { e.preventDefault(); e.currentTarget.classList.remove('drag-over'); setUploadFile(e.dataTransfer.files[0]); }}>
                  <input id="rx-file" type="file" accept=".pdf,.png,.jpg,.jpeg" hidden onChange={e => setUploadFile(e.target.files[0])} />
                  <div className="upload-zone-icon">📄</div>
                  <p style={{ fontWeight: 600, marginBottom: 4 }}>Drag & drop your prescription</p>
                  <p style={{ color: 'var(--text-faint)', fontSize: '0.85rem' }}>or click to browse (PDF, PNG, JPG)</p>
                </div>
                {uploadFile && (
                  <div className="file-preview" style={{ marginTop: 16 }}>
                    <span className="file-preview-icon">📎</span>
                    <div className="file-preview-info"><p style={{ fontWeight: 600, fontSize: '0.9rem' }} className="truncate">{uploadFile.name}</p><p style={{ color: 'var(--text-faint)', fontSize: '0.78rem' }}>{(uploadFile.size / 1024).toFixed(1)} KB</p></div>
                    <button className="btn btn-ghost btn-sm" onClick={() => setUploadFile(null)}>✕</button>
                  </div>
                )}
                <div className="grid-2" style={{ marginTop: 20 }}>
                  <div><label className="label">Doctor Name</label><input className="input" placeholder="Dr. Smith" value={uploadMeta.doctorName} onChange={e => setUploadMeta({ ...uploadMeta, doctorName: e.target.value })} /></div>
                  <div><label className="label">Date</label><input className="input" type="date" value={uploadMeta.date} onChange={e => setUploadMeta({ ...uploadMeta, date: e.target.value })} /></div>
                </div>
                <div style={{ marginTop: 12 }}><label className="label">Medication / Notes</label><textarea className="input" placeholder="Paracetamol 500mg, Twice daily..." value={uploadMeta.notes} onChange={e => setUploadMeta({ ...uploadMeta, notes: e.target.value })} /></div>
                <button className="btn btn-brand" style={{ marginTop: 20 }} onClick={uploadPrescription} disabled={loading || !uploadFile}>
                  {loading ? <><span className="spinner" /> Uploading...</> : '📤 Upload to Blockchain'}
                </button>
              </div>
            )}

            {/* Records Tab */}
            {dashTab === 'records' && (
              <div className="glass" style={{ padding: 32 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                  <h3 style={{ fontWeight: 700, color: 'var(--brand-light)' }}>Medical Records</h3>
                  <button className="btn btn-ghost btn-sm" onClick={fetchMyReports} disabled={loading}>🔄 Refresh</button>
                </div>
                {myReports.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-faint)' }}>
                    <div style={{ fontSize: '3rem', marginBottom: 12 }}>📭</div>
                    <p style={{ fontWeight: 600, marginBottom: 4 }}>No records found</p>
                    <p style={{ fontSize: '0.85rem' }}>Reports will appear here once uploaded by you or your doctor.</p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {myReports.map((r, i) => {
                      const hasFile = !!loadFile(r.ipfsHash);
                      return (
                        <div key={i} style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', padding: '16px 20px', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: '1.3rem' }}>{reportTypeIcon(r.reportType)}</span>
                              <span className="badge badge-brand">{r.reportType}</span>
                              <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>#{r.id}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>{r.timestamp}</span>
                              {hasFile && (
                                <>
                                  <button className="btn btn-ghost btn-sm" onClick={() => openDocument(r.ipfsHash, r.reportType)} style={{ gap: 4 }}>👁️ View</button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => downloadDocument(r.ipfsHash, r.reportType)} style={{ gap: 4 }}>⬇️</button>
                                </>
                              )}
                            </div>
                          </div>
                          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 8, fontFamily: 'monospace' }} className="truncate">CID: {r.ipfsHash}</p>
                          <p style={{ fontSize: '0.78rem', color: 'var(--text-faint)', marginTop: 4 }}>Uploaded by: {r.uploadedBy.substring(0, 10)}...{r.uploadedBy.substring(38)}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Access Tab */}
            {dashTab === 'access' && (
              <div className="glass" style={{ padding: 32 }}>
                <h3 style={{ fontWeight: 700, marginBottom: 20, color: 'var(--brand-light)' }}>Manage Doctor Access</h3>
                <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
                  <input className="input" placeholder="Enter doctor's wallet address (0x...)" value={doctorAddr} onChange={e => setDoctorAddr(e.target.value)} />
                  <button className="btn btn-brand" onClick={grantAccess} disabled={loading} style={{ whiteSpace: 'nowrap' }}>✅ Grant</button>
                </div>
                <h4 style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--text-faint)', textTransform: 'uppercase', marginBottom: 12 }}>Authorized Doctors</h4>
                {authorizedDocs.length === 0 ? (
                  <p style={{ color: 'var(--text-faint)', fontSize: '0.9rem' }}>No doctors authorized yet.</p>
                ) : authorizedDocs.map((doc, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', padding: '12px 16px', border: '1px solid var(--border)', marginBottom: 8 }}>
                    <span className="mono" style={{ fontSize: '0.88rem', color: 'var(--text-secondary)' }}>{doc}</span>
                    <button className="btn btn-danger btn-sm" onClick={() => revokeAccess(doc)}>Revoke</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════ DOCTOR DASHBOARD ════════ */}
        {view === 'doctor-dash' && profile && (
          <div className="animate-fade" style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
              <div className="avatar avatar-accent">{profile.fullName?.charAt(0)?.toUpperCase()}</div>
              <div>
                <h2 style={{ fontSize: '1.6rem', fontWeight: 800 }}>{profile.fullName}</h2>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  {profile.specialization && <span className="badge badge-accent">{profile.specialization}</span>}
                  {profile.hospital && <span className="badge badge-health">{profile.hospital}</span>}
                </div>
              </div>
            </div>
            <div className="tabs" style={{ marginBottom: 24 }}>
              {['profile', 'search', 'add-report'].map(t => (
                <button key={t} className={`tab tab-accent ${dashTab === t ? 'tab-active' : ''}`} onClick={() => setDashTab(t)}>
                  {{ profile: '👤 Profile', search: '🔍 Search Patient', 'add-report': '📄 Add Report' }[t]}
                </button>
              ))}
            </div>

            {/* Doctor Profile */}
            {dashTab === 'profile' && (
              <div className="glass" style={{ padding: 32 }}>
                <h3 style={{ fontWeight: 700, marginBottom: 20, color: 'var(--accent-light)' }}>Doctor Profile</h3>
                <div className="grid-3">
                  {[
                    ['Full Name', profile.fullName], ['Specialization', profile.specialization || '—'], ['Hospital', profile.hospital || '—'],
                    ['License No.', profile.licenseNo || '—'], ['Experience', profile.experience ? `${profile.experience} years` : '—'], ['Languages', profile.languages || '—'],
                    ['Phone', profile.phone || '—'], ['Email', profile.email || '—'], ['Gender', profile.gender || '—']
                  ].map(([label, val], i) => (
                    <div key={i}><span style={{ fontSize: '0.78rem', color: 'var(--text-faint)', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span><p style={{ fontWeight: 600, marginTop: 4 }}>{val}</p></div>
                  ))}
                </div>
              </div>
            )}

            {/* Search Patient */}
            {dashTab === 'search' && (
              <div className="glass" style={{ padding: 32 }}>
                <h3 style={{ fontWeight: 700, marginBottom: 20, color: 'var(--accent-light)' }}>Search Patient Records</h3>
                <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
                  <input className="input" placeholder="Enter patient's wallet address (0x...)" value={searchPatientAddr} onChange={e => setSearchPatientAddr(e.target.value)} />
                  <button className="btn btn-accent" onClick={fetchPatientReports} disabled={loading} style={{ whiteSpace: 'nowrap' }}>🔍 Search</button>
                </div>
                {patientReports.length === 0 && searchPatientAddr && (
                  <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-faint)' }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: 10 }}>📭</div>
                    <p>No records found for this patient, or access has not been granted.</p>
                  </div>
                )}
                {patientReports.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-faint)', marginBottom: 4 }}>
                      {patientReports.length} record{patientReports.length !== 1 ? 's' : ''} found
                    </p>
                    {patientReports.map((r, i) => {
                      const hasFile = !!loadFile(r.ipfsHash);
                      return (
                        <div key={i} style={{ background: 'var(--bg-input)', borderRadius: 'var(--radius-md)', padding: '16px 20px', border: '1px solid var(--border)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ fontSize: '1.3rem' }}>{reportTypeIcon(r.reportType)}</span>
                              <span className="badge badge-accent">{r.reportType}</span>
                              <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>#{r.id}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span style={{ color: 'var(--text-faint)', fontSize: '0.8rem' }}>{r.timestamp}</span>
                              {hasFile && (
                                <>
                                  <button className="btn btn-ghost btn-sm" onClick={() => openDocument(r.ipfsHash, r.reportType)}>👁️ View</button>
                                  <button className="btn btn-ghost btn-sm" onClick={() => downloadDocument(r.ipfsHash, r.reportType)}>⬇️</button>
                                </>
                              )}
                            </div>
                          </div>
                          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 8, fontFamily: 'monospace' }} className="truncate">CID: {r.ipfsHash}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Add Report */}
            {dashTab === 'add-report' && (
              <div className="glass" style={{ padding: 32 }}>
                <h3 style={{ fontWeight: 700, marginBottom: 20, color: 'var(--accent-light)' }}>Add Medical Report</h3>
                <div style={{ marginBottom: 16 }}><label className="label">Patient Address *</label><input className="input" placeholder="0x..." value={docReportMeta.patientAddr} onChange={e => setDocReportMeta({ ...docReportMeta, patientAddr: e.target.value })} /></div>
                <div className="grid-2">
                  <div><label className="label">Report Type</label><select className="input" value={docReportMeta.type} onChange={e => setDocReportMeta({ ...docReportMeta, type: e.target.value })}><option>Blood Test</option><option>MRI Scan</option><option>X-Ray</option><option>CT Scan</option><option>Ultrasound</option><option>ECG</option><option>Prescription</option><option>Consultancy Report</option></select></div>
                  <div><label className="label">Notes</label><input className="input" placeholder="Brief notes..." value={docReportMeta.notes} onChange={e => setDocReportMeta({ ...docReportMeta, notes: e.target.value })} /></div>
                </div>
                <div style={{ marginTop: 16 }}>
                  <label className="label">Attach File (optional)</label>
                  <div className="upload-zone" style={{ padding: 24 }} onClick={() => document.getElementById('doc-file').click()}>
                    <input id="doc-file" type="file" hidden onChange={e => setDocReportFile(e.target.files[0])} />
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{docReportFile ? `📎 ${docReportFile.name}` : 'Click to attach a file'}</p>
                  </div>
                </div>
                <button className="btn btn-accent" style={{ marginTop: 20 }} onClick={addDoctorReport} disabled={loading}>
                  {loading ? <><span className="spinner" /> Submitting...</> : '📄 Submit Report'}
                </button>
              </div>
            )}
          </div>
        )}

      </main>
      <Footer />
    </>
  );
}

export default App;
