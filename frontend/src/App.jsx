import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

const API_URL = "http://localhost:5000/api";

function App() {
  const [view, setView] = useState("assistant");
  const [description, setDescription] = useState("I want to install a floating shelf on my wall");
  const [problemImage, setProblemImage] = useState(null);
  const [plan, setPlan] = useState(null);
  const [planSource, setPlanSource] = useState("");
  const [tools, setTools] = useState([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [rentalCount, setRentalCount] = useState(0);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem("fixmateUser") || "null"));
  const [token, setToken] = useState(() => localStorage.getItem("fixmateToken") || "");
  const [authOpen, setAuthOpen] = useState(false);
  const [dashboardTab, setDashboardTab] = useState("listings");
  const [afterAuthView, setAfterAuthView] = useState(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [locationStatus, setLocationStatus] = useState("requesting");
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef(null);
  const hasSession = Boolean(token && user);

  useEffect(() => {
    const loadTools = (position) => {
      const params = new URLSearchParams({ available: "true" });
      if (position) {
        params.set("latitude", position.coords.latitude);
        params.set("longitude", position.coords.longitude);
      }
      fetch(`${API_URL}/tools?${params}`).then((response) => response.json()).then((data) => setTools(data.tools || [])).catch(() => setNotice("Backend is offline. Start it with npm run dev in backend."));
    };
    if (!navigator.geolocation) {
      setLocationStatus("unavailable");
      loadTools(null);
      return;
    }
    navigator.geolocation.getCurrentPosition((position) => {
      setLocationStatus("ready");
      loadTools(position);
    }, () => {
      setLocationStatus("denied");
      loadTools(null);
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }, []);

  const visibleTools = useMemo(() => tools.filter((tool) => `${tool.name} ${tool.category}`.toLowerCase().includes(search.toLowerCase())), [tools, search]);

  function toggleVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setNotice("Voice input is not supported in this browser. Try Chrome or Edge.");
      return;
    }
    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => {
      setIsListening(true);
      setNotice("Listening... describe the repair, then pause.");
    };
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript.trim();
      setDescription((current) => current && !current.startsWith("I want to install") ? `${current} ${transcript}` : transcript);
      setNotice("Voice description added.");
    };
    recognition.onerror = (event) => setNotice(event.error === "not-allowed" ? "Microphone permission was denied." : "Could not understand the voice input. Please try again.");
    recognition.onend = () => {
      setIsListening(false);
      recognitionRef.current = null;
    };
    recognitionRef.current = recognition;
    recognition.start();
  }

  function handleImageChange(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setNotice("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setNotice("Image must be 5 MB or smaller.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setProblemImage({ name: file.name, dataUrl: reader.result });
    reader.onerror = () => setNotice("Could not read that image. Please try again.");
    reader.readAsDataURL(file);
  }

  async function generatePlan(event) {
    event.preventDefault();
    setLoading(true);
    setNotice("");
    try {
      const response = await fetch(`${API_URL}/ai/repair-plan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description, image: problemImage?.dataUrl || null }), signal: AbortSignal.timeout(30000) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setPlan(data.plan);
      setPlanSource(data.source);
      setView("plan");
    } catch (error) {
      setNotice(error.name === "TimeoutError" ? "The AI took too long to respond. Please try again." : error.message || "Could not generate a plan.");
    } finally {
      setLoading(false);
    }
  }

  async function requestRental(toolId) {
    if (!token) {
      setAuthOpen(true);
      setNotice("Create an account or sign in to request a rental.");
      return;
    }

    try {
      const response = await fetch(`${API_URL}/rentals`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ toolId, startDate: new Date().toISOString().slice(0, 10), endDate: new Date(Date.now() + 86400000).toISOString().slice(0, 10) }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setRentalCount((count) => count + 1);
      setNotice(data.message);
    } catch (error) {
      setNotice(error.message);
    }

  }

  function openDashboard(tab) {
    if (!hasSession) {
      setAfterAuthView({ view: "dashboard", tab });
      setAuthOpen(true);
      setNotice("Sign in to open your dashboard.");
      return;
    }
    setDashboardTab(tab);
    setView("dashboard");
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("assistant")}><span className="brand-mark">✦</span> FixMate <span>AI</span></button>
        <nav>
          <button className={view === "assistant" || view === "plan" ? "active" : ""} onClick={() => setView("assistant")}>Repair assistant</button>
          <button className={view === "marketplace" ? "active" : ""} onClick={() => setView("marketplace")}>Marketplace <b>{tools.length}</b></button>
          <button onClick={() => openDashboard("listings")}>My dashboard</button>
        </nav>
        <div className="account-area">
          <button className="avatar" aria-label="Open account menu" onClick={() => setAccountMenuOpen((open) => !open)}>{hasSession ? user.name.slice(0, 2).toUpperCase() : "IN"}</button>
          {accountMenuOpen && <AccountMenu user={user} hasSession={hasSession} onSignIn={() => { setAccountMenuOpen(false); setAuthOpen(true); }} onDashboard={() => { setAccountMenuOpen(false); openDashboard("listings"); }} onLogout={() => { localStorage.removeItem("fixmateToken"); localStorage.removeItem("fixmateUser"); setToken(""); setUser(null); setView("assistant"); setAccountMenuOpen(false); setNotice("You have been signed out."); }} />}
        </div>
      </header>

      <main>
        <div className="eyebrow"><span className="live-dot" /> AI-powered home repair, made simple</div>
        <div className="view-transition" key={view}>
          {view === "marketplace" ? (
            <Marketplace tools={visibleTools} search={search} setSearch={setSearch} requestRental={requestRental} locationStatus={locationStatus} />
          ) : view === "dashboard" ? (
            <DashboardPanel token={token} tab={dashboardTab} setTab={setDashboardTab} setNotice={setNotice} />
          ) : view === "plan" && plan ? (
            <Plan plan={plan} source={planSource} onMarketplace={() => setView("marketplace")} />
          ) : (
            <section className="hero-grid">
              <div className="hero-copy">
                <h1>Fix it.<br /><em>Learn it.</em><br />Rent it.</h1>
                <p className="hero-text">Describe what’s broken. Get a clear, safe repair plan and find the exact tools you need from people nearby.</p>
                <div className="trust-row"><span>✦ Powered by AI</span><span>◉ Real local listings</span><span>✓ Safety first</span></div>
              </div>
              <form className="repair-card" onSubmit={generatePlan}>
                <div className="card-heading"><span className="sparkle">✦</span><div><h2>What needs fixing?</h2><p>Tell us what’s going on, or add a photo.</p></div></div>
                <div className="description-input"><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. My kitchen tap is leaking..." /><button type="button" className={`voice-button ${isListening ? "listening" : ""}`} onClick={toggleVoiceInput} aria-label={isListening ? "Stop voice input" : "Start voice input"}>{isListening ? "■" : "🎙"}</button></div>
                <div className="photo-upload">
                  <label htmlFor="problem-photo" className="photo-button">📷 Add a photo</label>
                  <input id="problem-photo" type="file" accept="image/*" onChange={handleImageChange} />
                  {problemImage && <div className="photo-preview"><img src={problemImage.dataUrl} alt="Repair problem preview" /><span>{problemImage.name}</span><button type="button" onClick={() => setProblemImage(null)} aria-label="Remove photo">×</button></div>}
                </div>
                <div className="suggestions"><span>Try an example:</span><button type="button" onClick={() => setDescription("My kitchen tap is leaking at the base")}>Leaking tap</button><button type="button" onClick={() => setDescription("I want to install a shelf on a brick wall")}>Install a shelf</button></div>
                <button className="primary-button" disabled={loading}>{loading ? "Thinking..." : "Build my repair plan  →"}</button>
                {notice && <p className="notice">{notice}</p>}
                <p className="fine-print">FixMate provides guidance, not a substitute for a qualified professional.</p>
              </form>
            </section>
          )}
        </div>
        {view === "assistant" && <section className="feature-strip"><div><strong>01</strong><h3>Describe</h3><p>Explain the problem in your own words.</p></div><div><strong>02</strong><h3>Understand</h3><p>Get a plan with tools, steps and safety tips.</p></div><div><strong>03</strong><h3>Find nearby</h3><p>Rent verified tools instead of buying once.</p></div></section>}
      </main>
      {authOpen && <AuthModal onClose={() => { setAuthOpen(false); setAfterAuthView(null); }} onSuccess={(data) => {
        if (!data?.token || !data?.user) return setNotice("Login succeeded but the server returned an incomplete session.");
        setToken(data.token);
        setUser(data.user);
        localStorage.setItem("fixmateToken", data.token);
        localStorage.setItem("fixmateUser", JSON.stringify(data.user));
        setAuthOpen(false);
        if (afterAuthView) {
          setDashboardTab(afterAuthView.tab || "listings");
          setView(afterAuthView.view);
          setAfterAuthView(null);
        }

        setNotice(`Welcome, ${data.user.name}.`);
      }} />}
      <footer><span>© 2026 FixMate AI</span><span>Built for safer, smarter DIY</span><span>{rentalCount ? `${rentalCount} rental request sent` : "Demo mode · Inventory clearly labeled"}</span></footer>
    </div>
  );
}

function AccountMenu({ user, hasSession, onSignIn, onDashboard, onLogout }) {
  if (!hasSession) return <div className="account-menu signed-out"><strong>Welcome to FixMate</strong><p>Sign in to request tools and manage your rentals.</p><button onClick={onSignIn}>Sign in / Register</button></div>;
  return <div className="account-menu"><div className="account-summary"><span className="menu-avatar">{user.name.slice(0, 2).toUpperCase()}</span><div><strong>{user.name}</strong><p>{user.email}</p></div></div><button onClick={onDashboard}>▦ <span>My dashboard</span></button><button onClick={() => alert(`Profile: ${user.name}\n${user.email}\n${user.location || "Location not set"}`)}>◎ <span>Profile information</span></button><button className="logout-button" onClick={onLogout}>↪ <span>Log out</span></button></div>;
}

function Dashboard(props) {
  const [message, setMessage] = useState("Loading your workspace...");
  useEffect(() => {
    fetch(`${API_URL}/tools/my-listings`, { headers: { Authorization: `Bearer ${props.token}` } })
      .then((response) => response.json())
      .then((data) => setMessage(data.tools?.length ? `${data.tools.length} listing(s) found.` : "You have no listings yet. Use the marketplace to find tools, or add a listing from the backend API."))
      .catch(() => setMessage("Could not load your workspace."));
  }, [props.token]);
  return <section className="dashboard"><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>My dashboard.</h1><p>{message}</p></div></div><div className="dashboard-tabs"><button className={props.tab === "listings" ? "selected" : ""} onClick={() => props.setTab("listings")}>My listings</button><button className={props.tab === "requests" ? "selected" : ""} onClick={() => props.setTab("requests")}>Rental requests</button><button className="selected" onClick={() => props.setNotice("Tool listing creation is available through POST /api/tools with your account token.")}>+ List a tool</button></div><div className="empty-card">Your authenticated dashboard is connected. Rental requests and listings are persisted in MongoDB.</div></section>;
}

function AuthModal({ onClose, onSuccess }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", location: "" });
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    setError("");
    const response = await fetch(`${API_URL}/auth/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const data = await response.json();
    if (!response.ok) return setError(data.message || "Authentication failed.");
    onSuccess(data);
  }

  function DashboardContent({ token, tab, setTab, setNotice }) {
    const [rentals, setRentals] = useState([]);
    const [listings, setListings] = useState([]);
    const [form, setForm] = useState({ name: "", category: "Hand tools", description: "", pricePerHour: "", pricePerDay: "", location: "", condition: "Good" });
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };

    async function load() {
      const [rentalResponse, listingResponse] = await Promise.all([fetch(`${API_URL}/rentals/my-requests`, { headers }), fetch(`${API_URL}/tools/my-listings`, { headers })]);
      const rentalData = await rentalResponse.json();
      const listingData = await listingResponse.json();
      setRentals(rentalData.rentals || []);
      setListings(listingData.tools || []);
    }
    useEffect(() => { load().catch(() => setNotice("Could not load dashboard data.")); }, []);

    async function createListing(event) {
      event.preventDefault();
      const response = await fetch(`${API_URL}/tools`, { method: "POST", headers, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) return setNotice(data.message);
      setForm({ name: "", category: "Hand tools", description: "", pricePerHour: "", pricePerDay: "", location: "", condition: "Good" });
      setNotice("Tool listing created.");
      load();
    }

    async function updateRental(id, status) {
      const response = await fetch(`${API_URL}/rentals/${id}/status`, { method: "PATCH", headers, body: JSON.stringify({ status }) });
      const data = await response.json();
      setNotice(data.message);
      load();
    }

    return <section className="dashboard"><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>My dashboard.</h1><p>Share tools and manage your repair requests.</p></div></div><div className="dashboard-tabs"><button className={tab === "listings" ? "selected" : ""} onClick={() => setTab("listings")}>My listings</button><button className={tab === "requests" ? "selected" : ""} onClick={() => setTab("requests")}>Rental requests</button><button className={tab === "add" ? "selected" : ""} onClick={() => setTab("add")}>+ List a tool</button></div>{tab === "add" && <form className="listing-form" onSubmit={createListing}><h2>List a tool</h2><input required placeholder="Tool name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Hand tools</option><option>Power tools</option><option>Measuring</option><option>Safety equipment</option></select><textarea required placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><div className="form-row"><input required type="number" min="1" placeholder="Daily price ₹" value={form.pricePerDay} onChange={(event) => setForm({ ...form, pricePerDay: event.target.value })} /><input type="number" min="1" placeholder="Hourly price ₹" value={form.pricePerHour} onChange={(event) => setForm({ ...form, pricePerHour: event.target.value })} /></div><div className="form-row"><input required placeholder="Location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /><input placeholder="Condition" value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} /></div><button className="primary-button">Publish listing</button></form>}{tab === "listings" && <div className="dashboard-list">{listings.length ? listings.map((listing) => <div className="dashboard-item" key={listing._id}><strong>{listing.name}</strong><span>{listing.category} · ₹{listing.pricePerDay}/day · {listing.location}</span></div>) : <div className="empty-card">You have no listings yet. Add a tool to help someone nearby.</div>}</div>}{tab === "requests" && <div className="dashboard-list">{rentals.length ? rentals.map((rental) => <div className="dashboard-item" key={rental._id || rental.id}><div><strong>{rental.toolName || rental.toolId?.name || "Tool rental"}</strong><span>{rental.startDate?.slice(0, 10)} → {rental.endDate?.slice(0, 10)}</span></div><div className="request-actions"><b className={`status-${rental.status}`}>{rental.status}</b>{rental.status === "pending" && <><button onClick={() => updateRental(rental._id || rental.id, "accepted")}>Accept</button><button onClick={() => updateRental(rental._id || rental.id, "rejected")}>Reject</button></>}</div></div>) : <div className="empty-card">No rental requests yet.</div>}</div>}</section>;
  }
  return <div className="modal-backdrop" onClick={onClose}><form className="auth-modal" onSubmit={submit} onClick={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onClose}>×</button><div className="eyebrow">{mode === "login" ? "WELCOME BACK" : "JOIN THE COMMUNITY"}</div><h2>{mode === "login" ? "Sign in to FixMate" : "Create your account"}</h2>{mode === "register" && <><input required placeholder="Your name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><input placeholder="Your neighborhood" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /></>}<input required type="email" placeholder="Email address" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /><input required minLength="8" type="password" placeholder="Password (8+ characters)" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />{error && <p className="notice">{error}</p>}<button className="primary-button">{mode === "login" ? "Sign in" : "Create account"}</button><button type="button" className="switch-auth" onClick={() => setMode(mode === "login" ? "register" : "login")}>{mode === "login" ? "Need an account? Register" : "Already registered? Sign in"}</button></form></div>;
}

function Plan({ plan, source, onMarketplace }) {
  return <section className="plan-page"><button className="back-button" onClick={() => window.location.reload()}>← New repair</button><div className="plan-header"><div><div className="eyebrow">YOUR PERSONALIZED PLAN</div><h1>{plan.summary}</h1><p>{plan.problem}</p><small className="plan-source">Generated by {source}</small></div><span className="safe-badge">✦ Safety-first</span></div><div className="plan-layout"><div><div className="section-title"><span>01</span><h2>Steps to try</h2></div><div className="steps">{plan.steps.map((item) => <div className="step" key={item.step}><b>{String(item.step).padStart(2, "0")}</b><p>{item.instruction}</p></div>)}</div>{plan.clarifyingQuestions.length > 0 && <div className="questions"><h3>Before you start</h3>{plan.clarifyingQuestions.map((question) => <p key={question}>? {question}</p>)}</div>}</div><aside className="tools-panel"><div className="section-title"><span>02</span><h2>Tools & materials</h2></div>{plan.tools.map((tool) => <div className="recommended-tool" key={tool.name}><span className="tool-icon">🛠</span><div><strong>{tool.name}</strong><p>{tool.reason}</p></div></div>)}{plan.materials.map((item) => <div className="material" key={item.name}>＋ {item.name}</div>)}<button className="primary-button" onClick={onMarketplace}>Find these tools nearby →</button></aside></div><div className="warning"><span>⚠</span><div><strong>Safety notes</strong>{plan.safetyWarnings.map((warning) => <p key={warning}>{warning}</p>)}</div></div></section>;
}

function Marketplace({ tools, search, setSearch, requestRental, locationStatus }) {
  const locationMessage = locationStatus === "ready" ? "Sorted by distance from you" : locationStatus === "requesting" ? "Finding tools near you..." : "Location unavailable · showing all listings";
  return <section className="marketplace"><div className="page-heading"><div><div className="eyebrow">COMMUNITY TOOL LIBRARY</div><h1>Borrow, don’t buy.</h1><p>Real tools listed by people in your neighborhood.</p><small className="location-note">⌖ {locationMessage}</small></div><span className="demo-label">COMMUNITY INVENTORY</span></div><input className="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search drills, levels, wrenches..." /><div className="tool-grid">{tools.map((tool) => { const id = tool.id || tool._id; return <article className="tool-card" key={id}><div className="tool-image">{tool.icon || "🛠️"}<span className="available">Available</span></div><div className="tool-body"><div className="tool-meta">{tool.category} · ★ {tool.rating || "new"}</div><h3>{tool.name}</h3><p>{tool.description}</p><div className="tool-owner">● {tool.owner || "Community member"} · {tool.location}</div><div className="price"><strong>₹{tool.pricePerDay}</strong> / day {tool.distanceKm !== null && <small>{tool.distanceKm} km away</small>}<button onClick={() => requestRental(id)}>Request rental</button></div></div></article>; })}</div>{tools.length === 0 && <p className="empty">No matching tools found.</p>}</section>;
}

export default App;

function DashboardPanel({ token, tab, setTab, setNotice }) {
  const [listings, setListings] = useState([]);
  const [requests, setRequests] = useState([]);
  const [form, setForm] = useState({ name: "", category: "Hand tools", description: "", pricePerHour: "", pricePerDay: "", location: "", condition: "Good" });
  const [busy, setBusy] = useState(false);
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  async function load() {
    const [listingResponse, requestResponse] = await Promise.all([fetch(`${API_URL}/tools/my-listings`, { headers }), fetch(`${API_URL}/rentals/owner-requests`, { headers })]);
    if (!listingResponse.ok || !requestResponse.ok) throw new Error("Could not load dashboard data.");
    setListings((await listingResponse.json()).tools || []);
    setRequests((await requestResponse.json()).rentals || []);
  }
  useEffect(() => { load().catch((error) => setNotice(error.message)); }, [token]);
  async function createListing(event) {
    event.preventDefault();
    setBusy(true);
    try {
      const response = await fetch(`${API_URL}/tools`, { method: "POST", headers, body: JSON.stringify(form) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);
      setForm({ name: "", category: "Hand tools", description: "", pricePerHour: "", pricePerDay: "", location: "", condition: "Good" });
      setNotice("Tool listing created.");
      await load();
      setTab("listings");
    } catch (error) { setNotice(error.message); } finally { setBusy(false); }
  }
  async function updateRequest(id, status) {
    const response = await fetch(`${API_URL}/rentals/${id}/status`, { method: "PATCH", headers, body: JSON.stringify({ status }) });
    const data = await response.json();
    setNotice(data.message);
    await load();
  }
  return <section className="dashboard"><div className="page-heading"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>My dashboard.</h1><p>Share tools and manage rental requests.</p></div></div><div className="dashboard-tabs"><button className={tab === "listings" ? "selected" : ""} onClick={() => setTab("listings")}>My listings</button><button className={tab === "requests" ? "selected" : ""} onClick={() => setTab("requests")}>Rental requests</button><button className={tab === "add" ? "selected" : ""} onClick={() => setTab("add")}>+ List a tool</button></div>{tab === "add" && <form className="listing-form" onSubmit={createListing}><h2>List a tool</h2><input required placeholder="Tool name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /><select value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}><option>Hand tools</option><option>Power tools</option><option>Measuring</option></select><textarea required placeholder="Description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /><div className="form-row"><input required type="number" min="1" placeholder="Daily price ₹" value={form.pricePerDay} onChange={(event) => setForm({ ...form, pricePerDay: event.target.value })} /><input type="number" min="1" placeholder="Hourly price ₹" value={form.pricePerHour} onChange={(event) => setForm({ ...form, pricePerHour: event.target.value })} /></div><div className="form-row"><input required placeholder="Location" value={form.location} onChange={(event) => setForm({ ...form, location: event.target.value })} /><input placeholder="Condition" value={form.condition} onChange={(event) => setForm({ ...form, condition: event.target.value })} /></div><button className="primary-button" disabled={busy}>{busy ? "Publishing..." : "Publish listing"}</button></form>}{tab === "listings" && <div className="dashboard-list">{listings.length ? listings.map((listing) => <div className="dashboard-item" key={listing._id}><strong>{listing.name}</strong><span>{listing.category} · ₹{listing.pricePerDay}/day · {listing.location}</span></div>) : <div className="empty-card">You have no listings yet. Add your first tool.</div>}</div>}{tab === "requests" && <div className="dashboard-list">{requests.length ? requests.map((request) => <div className="dashboard-item" key={request._id || request.id}><div><strong>{request.toolName || request.toolId?.name || "Tool rental"}</strong><span>{String(request.startDate).slice(0, 10)} → {String(request.endDate).slice(0, 10)}</span></div><div className="request-actions"><b className={`status-${request.status}`}>{request.status}</b>{request.status === "pending" && <><button onClick={() => updateRequest(request._id || request.id, "accepted")}>Accept</button><button onClick={() => updateRequest(request._id || request.id, "rejected")}>Reject</button></>}</div></div>) : <div className="empty-card">No rental requests yet.</div>}</div>}</section>;
}
