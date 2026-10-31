require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { generateWithOllama, generateWithGemini } = require("./services/ai.service");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "fixmate-local-development-secret";
const isDatabaseReady = () => mongoose.connection.readyState === 1;

const userSchema = new mongoose.Schema({ name: { type: String, required: true, trim: true }, email: { type: String, required: true, unique: true, lowercase: true, trim: true }, passwordHash: { type: String, required: true }, location: { type: String, default: "" } }, { timestamps: true });
const toolSchema = new mongoose.Schema({ ownerId: mongoose.Schema.Types.ObjectId, name: { type: String, required: true, trim: true }, description: String, category: String, pricePerHour: Number, pricePerDay: Number, location: String, latitude: Number, longitude: Number, available: { type: Boolean, default: true }, condition: String, image: String, icon: String, rating: Number, owner: String }, { timestamps: true });
const rentalSchema = new mongoose.Schema({ toolId: mongoose.Schema.Types.ObjectId, ownerId: mongoose.Schema.Types.ObjectId, renterId: mongoose.Schema.Types.ObjectId, startDate: Date, endDate: Date, totalPrice: Number, status: { type: String, enum: ["pending", "accepted", "rejected", "cancelled"], default: "pending" } }, { timestamps: true });
const User = mongoose.models.User || mongoose.model("User", userSchema);
const Tool = mongoose.models.Tool || mongoose.model("Tool", toolSchema);
const Rental = mongoose.models.Rental || mongoose.model("Rental", rentalSchema);

const demoUsers = new Map();
const demoTools = [
  { id: "tool-1", name: "Cordless Drill", category: "Power tools", description: "18V drill with masonry and wood bits.", pricePerDay: 12, pricePerHour: 3, location: "Koramangala", latitude: 12.9352, longitude: 77.6245, owner: "Arjun", available: true, rating: 4.9, icon: "🔩" },
  { id: "tool-2", name: "Spirit Level", category: "Hand tools", description: "60cm level for accurate shelf alignment.", pricePerDay: 5, pricePerHour: 1, location: "Indiranagar", latitude: 12.9784, longitude: 77.6408, owner: "Meera", available: true, rating: 4.8, icon: "📏" },
  { id: "tool-3", name: "Stud Finder", category: "Measuring", description: "Digital wall scanner for locating studs and wires.", pricePerDay: 8, pricePerHour: 2, location: "HSR Layout", latitude: 12.9116, longitude: 77.6474, owner: "Rohan", available: true, rating: 4.7, icon: "📡" },
  { id: "tool-4", name: "Hammer Drill", category: "Power tools", description: "Heavy-duty drill for brick and concrete walls.", pricePerDay: 18, pricePerHour: 5, location: "Whitefield", latitude: 12.9698, longitude: 77.75, owner: "Nisha", available: false, rating: 4.6, icon: "🛠️" },
  { id: "tool-5", name: "Adjustable Wrench", category: "Hand tools", description: "Versatile wrench for plumbing and fittings.", pricePerDay: 6, pricePerHour: 2, location: "Koramangala", latitude: 12.9352, longitude: 77.6245, owner: "Vikram", available: true, rating: 4.8, icon: "🔧" },
];
const demoRentals = [];

async function seedToolsIfEmpty() {
  if (!isDatabaseReady() || await Tool.exists({})) return;
  await Tool.insertMany(demoTools.map(({ id, ...tool }) => ({ ...tool, owner: `${tool.owner} (demo)`, icon: tool.icon, rating: tool.rating })));
  console.log("Seeded demo tool inventory into MongoDB");
}

app.use(cors());
app.use(helmet());
app.use(morgan("dev"));
app.use(express.json({ limit: "8mb" }));

function signUser(user) { return jwt.sign({ id: String(user._id || user.id), email: user.email, name: user.name }, JWT_SECRET, { expiresIn: "7d" }); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function distanceInKm(latitude, longitude, tool) {
  if (!Number.isFinite(tool.latitude) || !Number.isFinite(tool.longitude)) return null;
  const radians = (value) => value * Math.PI / 180;
  const deltaLatitude = radians(tool.latitude - latitude);
  const deltaLongitude = radians(tool.longitude - longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2 + Math.cos(radians(latitude)) * Math.cos(radians(tool.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return Math.round(6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) * 10) / 10;
}
function auth(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ message: "Authentication required." });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); } catch { return res.status(401).json({ message: "Your session has expired. Please sign in again." }); }
}
function createRepairPlan(description) {
  const text = description.toLowerCase();
  const electrical = /electric|wire|socket|switch|breaker|mains/.test(text);
  const shelf = text.includes("shelf") || text.includes("wall");
  if (electrical) return { problem: description, summary: "This may involve household electrical wiring.", clarifyingQuestions: ["Can you switch off the circuit at the main breaker?", "Is there visible damage, heat, or a burning smell?"], steps: [{ step: 1, instruction: "Switch off the relevant circuit at the main breaker and do not work on live wiring." }, { step: 2, instruction: "For exposed, damaged, or uncertain wiring, stop and contact a licensed electrician." }], tools: [{ name: "Voltage tester", quantity: 1, reason: "Only for confirming a circuit is de-energized." }], materials: [], safetyWarnings: ["Electrical work can cause shock, fire, or serious injury. A qualified electrician is recommended."], professionalHelpRecommended: true };
  return { problem: description, summary: shelf ? "A careful wall-mounting plan with alignment and fixing checks." : "A practical first-pass repair plan based on your description.", clarifyingQuestions: shelf ? ["What is the wall material: concrete, brick, or drywall?", "How heavy will the shelf and its contents be?"] : ["What material is the damaged part made from?", "Is the area safe to handle and free from exposed utilities?"], steps: shelf ? [{ step: 1, instruction: "Mark mounting points and use a stud finder to check for studs or hidden wires." }, { step: 2, instruction: "Choose anchors and a drill bit suitable for the wall material and expected load." }, { step: 3, instruction: "Drill straight pilot holes, install anchors, and secure the brackets." }, { step: 4, instruction: "Check the shelf with a spirit level, then add weight gradually." }] : [{ step: 1, instruction: "Inspect the problem closely and identify the loose, broken, or worn component." }, { step: 2, instruction: "Clean the area and test the smallest safe adjustment first." }, { step: 3, instruction: "Make the repair, then test it gently before normal use." }], tools: shelf ? [{ name: "Cordless drill", quantity: 1, reason: "To drill clean pilot holes and install anchors." }, { name: "Spirit level", quantity: 1, reason: "To keep the shelf horizontal." }, { name: "Stud finder", quantity: 1, reason: "To locate studs and avoid hidden wires." }] : [{ name: "Adjustable wrench", quantity: 1, reason: "For common fittings during inspection and adjustment." }], materials: shelf ? [{ name: "Wall anchors", reason: "To secure brackets to the wall material." }, { name: "Screws", reason: "To attach brackets securely." }] : [], safetyWarnings: ["Wear eye protection when drilling.", "Stop if you encounter hidden wiring, gas, or structural damage."], professionalHelpRecommended: false };
}

app.get("/", (req, res) => res.json({ message: "FixMate AI backend is running", mode: isDatabaseReady() ? "database" : "demo" }));
app.get("/api/health", (req, res) => res.json({ ok: true, mode: isDatabaseReady() ? "database" : "demo" }));

app.post("/api/auth/register", async (req, res, next) => {
  try {
    const { name, email, password, location = "" } = req.body;
    if (!name?.trim() || !email?.trim() || !password || password.length < 8) return res.status(400).json({ message: "Name, email, and a password of at least 8 characters are required." });
    const normalizedEmail = email.toLowerCase().trim();
    if (isDatabaseReady()) {
      if (await User.exists({ email: normalizedEmail })) return res.status(409).json({ message: "An account with that email already exists." });
      const user = await User.create({ name: name.trim(), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 12), location });
      return res.status(201).json({ user: { name: user.name, email: user.email, location: user.location }, token: signUser(user) });
    }
    if (demoUsers.has(normalizedEmail)) return res.status(409).json({ message: "An account with that email already exists." });
    const user = { id: `user-${Date.now()}`, name: name.trim(), email: normalizedEmail, passwordHash: await bcrypt.hash(password, 10), location };
    demoUsers.set(normalizedEmail, user);
    res.status(201).json({ user: { name: user.name, email: user.email, location }, token: signUser(user), demoData: true });
  } catch (error) { next(error); }
});

app.post("/api/auth/login", async (req, res, next) => {
  try {
    const email = req.body.email?.toLowerCase().trim();
    const user = isDatabaseReady() ? await User.findOne({ email }) : demoUsers.get(email);
    if (!user || !(await bcrypt.compare(req.body.password || "", user.passwordHash))) return res.status(401).json({ message: "Invalid email or password." });
    res.json({ user: { name: user.name, email: user.email, location: user.location }, token: signUser(user), demoData: !isDatabaseReady() });
  } catch (error) { next(error); }
});

app.get("/api/users/me", auth, async (req, res, next) => {
  try { const user = isDatabaseReady() ? await User.findById(req.user.id).select("-passwordHash") : demoUsers.get(req.user.email); if (!user) return res.status(404).json({ message: "User not found." }); res.json({ user }); } catch (error) { next(error); }
});

app.post("/api/ai/repair-plan", async (req, res, next) => {
  try {
    const description = typeof req.body.description === "string" ? req.body.description.trim() : "";
    if (description.length < 8) return res.status(400).json({ message: "Please describe the repair in at least 8 characters." });
    const image = typeof req.body.image === "string" ? req.body.image : null;
    if (image && !/^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(image)) return res.status(400).json({ message: "Please upload a valid JPG, PNG, WEBP, or GIF image." });
    if (image && image.length > 7 * 1024 * 1024) return res.status(413).json({ message: "Image must be 5 MB or smaller." });
    if (process.env.AI_PROVIDER === "gemini" && process.env.GEMINI_API_KEY) {
      try {
        const plan = await generateWithGemini(description, image);
        return res.json({ plan, source: "Gemini API" });
      } catch (error) {
        console.warn(`Gemini unavailable; using local safety fallback: ${error.message}`);
      }
    }
    if (process.env.AI_PROVIDER === "ollama") {
      try {
        const plan = await generateWithOllama(description);
        return res.json({ plan, source: "Ollama local model" });
      } catch (error) {
        console.warn(`Ollama unavailable; using local safety fallback: ${error.message}`);
      }
    }
    res.json({ plan: createRepairPlan(description), source: "FixMate safety-first fallback" });
  } catch (error) { next(error); }
});

app.get("/api/tools", async (req, res, next) => {
  try {
    const search = String(req.query.search || "").toLowerCase();
    const latitude = Number(req.query.latitude);
    const longitude = Number(req.query.longitude);
    const result = isDatabaseReady() ? await Tool.find({ available: req.query.available !== "false", $or: [{ name: new RegExp(escapeRegex(search), "i") }, { category: new RegExp(escapeRegex(search), "i") }] }).lean() : demoTools.filter((tool) => `${tool.name} ${tool.category}`.toLowerCase().includes(search) && (req.query.available !== "true" || tool.available));
    const withDistance = result.map((tool) => ({ ...tool, distanceKm: Number.isFinite(latitude) && Number.isFinite(longitude) ? distanceInKm(latitude, longitude, tool) : null })).sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    res.json({ tools: withDistance, demoData: !isDatabaseReady(), locationApplied: Number.isFinite(latitude) && Number.isFinite(longitude) });
  } catch (error) { next(error); }
});

app.post("/api/tools", auth, async (req, res, next) => {
  try {
    const { name, description, category, pricePerHour, pricePerDay, location, condition } = req.body;
    if (!name || !category || !pricePerDay || !location) return res.status(400).json({ message: "Name, category, daily price, and location are required." });
    if (!isDatabaseReady()) return res.status(503).json({ message: "Listing creation requires MongoDB. Add MONGODB_URI to backend/.env." });
    const tool = await Tool.create({ ownerId: req.user.id, name, description, category, pricePerHour, pricePerDay, location, condition });
    res.status(201).json({ tool });
  } catch (error) { next(error); }
});

app.post("/api/rentals", auth, async (req, res, next) => {
  try {
    const { toolId, startDate, endDate } = req.body;
    if (!startDate || !endDate || Number.isNaN(new Date(startDate).getTime()) || Number.isNaN(new Date(endDate).getTime()) || new Date(endDate) <= new Date(startDate)) return res.status(400).json({ message: "Please provide a valid rental period." });
    if (isDatabaseReady()) {
      const tool = await Tool.findById(toolId);
      if (!tool || !tool.available) return res.status(404).json({ message: "Tool listing is unavailable." });
      const conflict = await Rental.exists({ toolId, status: "accepted", startDate: { $lt: new Date(endDate) }, endDate: { $gt: new Date(startDate) } });
      if (conflict) return res.status(409).json({ message: "This tool is already booked for those dates." });
      const days = Math.max(1, Math.ceil((new Date(endDate) - new Date(startDate)) / 86400000));
      const rental = await Rental.create({ toolId, ownerId: tool.ownerId, renterId: req.user.id, startDate, endDate, totalPrice: tool.pricePerDay * days });
      return res.status(201).json({ rental, message: "Rental request sent to the owner." });
    }
    const tool = demoTools.find((item) => item.id === toolId);
    if (!tool || !tool.available) return res.status(404).json({ message: "Tool listing is unavailable." });
    const rental = { id: `rental-${Date.now()}`, toolId, toolName: tool.name, startDate, endDate, status: "pending", renter: req.user.email };
    demoRentals.push(rental);
    res.status(201).json({ rental, message: "Rental request sent to the owner.", demoData: true });
  } catch (error) { next(error); }
});

app.get("/api/rentals/my-requests", auth, async (req, res, next) => {
  try { res.json({ rentals: isDatabaseReady() ? await Rental.find({ renterId: req.user.id }).populate("toolId", "name location") : demoRentals.filter((rental) => rental.renter === req.user.email) }); } catch (error) { next(error); }
});

app.get("/api/rentals/owner-requests", auth, async (req, res, next) => {
  try {
    if (!isDatabaseReady()) return res.json({ rentals: demoRentals, demoData: true });
    const rentals = await Rental.find({ ownerId: req.user.id }).populate("toolId", "name location").populate("renterId", "name email");
    res.json({ rentals });
  } catch (error) { next(error); }
});

app.patch("/api/rentals/:id/status", auth, async (req, res, next) => {
  try {
    const { status } = req.body;
    if (!["accepted", "rejected", "cancelled"].includes(status)) return res.status(400).json({ message: "Invalid rental status." });
    if (!isDatabaseReady()) {
      const rental = demoRentals.find((item) => item.id === req.params.id);
      if (!rental) return res.status(404).json({ message: "Rental request not found." });
      rental.status = status;
      return res.json({ rental, message: `Rental request ${status}.`, demoData: true });
    }
    const rental = await Rental.findOneAndUpdate({ _id: req.params.id, ownerId: req.user.id, status: "pending" }, { status }, { new: true });
    if (!rental) return res.status(404).json({ message: "Pending owner rental request not found." });
    res.json({ rental, message: `Rental request ${status}.` });
  } catch (error) { next(error); }
});

app.get("/api/tools/my-listings", auth, async (req, res, next) => {
  try {
    if (!isDatabaseReady()) return res.json({ tools: [], demoData: true });
    res.json({ tools: await Tool.find({ ownerId: req.user.id }).sort({ createdAt: -1 }) });
  } catch (error) { next(error); }
});

app.delete("/api/tools/:id", auth, async (req, res, next) => {
  try {
    if (!isDatabaseReady()) return res.status(503).json({ message: "Deleting listings requires MongoDB." });
    const tool = await Tool.findOneAndDelete({ _id: req.params.id, ownerId: req.user.id });
    if (!tool) return res.status(404).json({ message: "Listing not found." });
    res.json({ message: "Listing deleted." });
  } catch (error) { next(error); }
});

app.use((error, req, res, next) => { console.error(error); res.status(500).json({ message: "The server could not complete that request." }); });

if (process.env.MONGODB_URI) mongoose.connect(process.env.MONGODB_URI).then(async () => { console.log("MongoDB connected"); await seedToolsIfEmpty(); }).catch((error) => console.error("MongoDB connection failed:", error.message));
module.exports = app;
