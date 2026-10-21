require("dotenv").config();
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || "product_tracking_db",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD || "",
});

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, database: "connected" });
  } catch (err) {
    res.status(500).json({ ok: false, error: "Database connection failed", detail: err.message });
  }
});

app.get("/api/dashboard", async (_req, res) => {
  try {
    const q = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM products) AS total_products,
        (SELECT COALESCE(SUM(stock_quantity),0)::int FROM products) AS total_stock,
        (SELECT COUNT(*)::int FROM customers) AS total_customers,
        (SELECT COUNT(*)::int FROM orders) AS total_orders,
        (SELECT COUNT(*)::int FROM shipments WHERE LOWER(shipment_status) NOT IN ('delivered','cancelled')) AS active_shipments,
        (SELECT COUNT(*)::int FROM shipments WHERE LOWER(shipment_status) = 'delivered') AS delivered_shipments,
        (SELECT COALESCE(SUM(total_amount),0)::numeric(12,2) FROM orders) AS total_sales
    `);
    const recent = await pool.query(`
      SELECT o.order_id, o.order_date, o.order_status, o.total_amount,
             c.first_name, c.last_name,
             s.shipment_status, s.shipment_id
      FROM orders o
      LEFT JOIN customers c ON c.customer_id = o.customer_id
      LEFT JOIN shipments s ON s.order_id = o.order_id
      ORDER BY o.order_date DESC, o.order_id DESC LIMIT 6
    `);
    res.json({ stats: q.rows[0], recentOrders: recent.rows });
  } catch (err) {
    res.status(500).json({ error: "Could not load dashboard. Check table names and database connection.", detail: err.message });
  }
});

app.get("/api/products", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const result = await pool.query(`
      SELECT p.product_id, p.category_id, p.product_name, p.description,
             p.price, p.stock_quantity, c.category_name
      FROM products p
      LEFT JOIN categories c ON c.category_id = p.category_id
      WHERE ($1 = '' OR p.product_name ILIKE '%' || $1 || '%'
             OR COALESCE(c.category_name,'') ILIKE '%' || $1 || '%'
             OR CAST(p.product_id AS TEXT) = $1)
      ORDER BY p.product_id
    `, [search]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Could not load products.", detail: err.message });
  }
});

app.get("/api/categories", async (_req, res) => {
  try {
    const result = await pool.query("SELECT category_id, category_name FROM categories ORDER BY category_name");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Could not load categories.", detail: err.message });
  }
});

app.post("/api/products", async (req, res) => {
  const { product_name, category_id, description = "", price, stock_quantity } = req.body;
  if (!String(product_name || "").trim() || category_id === "" || category_id == null ||
      !Number.isFinite(Number(price)) || Number(price) < 0 ||
      !Number.isInteger(Number(stock_quantity)) || Number(stock_quantity) < 0) {
    return res.status(400).json({ error: "Enter a product name, category, valid price, and non-negative whole-number stock." });
  }
  try {
    const result = await pool.query(`
      INSERT INTO products (category_id, product_name, description, price, stock_quantity)
      VALUES ($1,$2,$3,$4,$5)
      RETURNING product_id, category_id, product_name, description, price, stock_quantity
    `, [Number(category_id), String(product_name).trim(), String(description), Number(price), Number(stock_quantity)]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Could not save product.", detail: err.message });
  }
});

app.put("/api/products/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { product_name, category_id, description = "", price, stock_quantity } = req.body;
  if (!Number.isInteger(id) || !String(product_name || "").trim() || category_id == null ||
      !Number.isFinite(Number(price)) || Number(price) < 0 ||
      !Number.isInteger(Number(stock_quantity)) || Number(stock_quantity) < 0) {
    return res.status(400).json({ error: "Invalid product details." });
  }
  try {
    const result = await pool.query(`
      UPDATE products SET category_id=$1, product_name=$2, description=$3, price=$4, stock_quantity=$5
      WHERE product_id=$6
      RETURNING product_id, category_id, product_name, description, price, stock_quantity
    `, [Number(category_id), String(product_name).trim(), String(description), Number(price), Number(stock_quantity), id]);
    if (!result.rowCount) return res.status(404).json({ error: "Product not found." });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: "Could not update product.", detail: err.message });
  }
});

app.delete("/api/products/:id", async (req, res) => {
  try {
    const result = await pool.query("DELETE FROM products WHERE product_id=$1 RETURNING product_id", [Number(req.params.id)]);
    if (!result.rowCount) return res.status(404).json({ error: "Product not found." });
    res.json({ ok: true, product_id: result.rows[0].product_id });
  } catch (err) {
    res.status(409).json({ error: "Could not delete product. It may already be used in an order item.", detail: err.message });
  }
});

app.get("/api/shipments", async (req, res) => {
  try {
    const search = String(req.query.search || "").trim();
    const result = await pool.query(`
      SELECT s.shipment_id, s.order_id, s.warehouse_id, s.agent_id, s.shipment_status,
             w.warehouse_name, w.city AS warehouse_city, a.name AS agent_name,
             o.order_status, o.total_amount,
             (SELECT t.current_location FROM tracking_updates t WHERE t.shipment_id=s.shipment_id ORDER BY t.update_time DESC, t.tracking_id DESC LIMIT 1) AS current_location,
             (SELECT t.update_time FROM tracking_updates t WHERE t.shipment_id=s.shipment_id ORDER BY t.update_time DESC, t.tracking_id DESC LIMIT 1) AS last_update
      FROM shipments s
      LEFT JOIN warehouses w ON w.warehouse_id=s.warehouse_id
      LEFT JOIN delivery_agents a ON a.agent_id=s.agent_id
      LEFT JOIN orders o ON o.order_id=s.order_id
      WHERE ($1='' OR CAST(s.shipment_id AS TEXT)=$1 OR CAST(s.order_id AS TEXT)=$1
             OR COALESCE(s.shipment_status,'') ILIKE '%' || $1 || '%'
             OR COALESCE(w.city,'') ILIKE '%' || $1 || '%')
      ORDER BY s.shipment_id
    `, [search]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Could not load shipments.", detail: err.message });
  }
});

app.get("/api/shipments/:id/tracking", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT tracking_id, shipment_id, current_location, status, update_time
      FROM tracking_updates WHERE shipment_id=$1
      ORDER BY update_time DESC, tracking_id DESC
    `, [Number(req.params.id)]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Could not load tracking history.", detail: err.message });
  }
});

app.post("/api/shipments/:id/tracking", async (req, res) => {
  const { current_location, status } = req.body;
  if (!String(current_location || "").trim() || !String(status || "").trim()) {
    return res.status(400).json({ error: "Location and status are required." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const exists = await client.query("SELECT shipment_id FROM shipments WHERE shipment_id=$1 FOR UPDATE", [Number(req.params.id)]);
    if (!exists.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Shipment not found." });
    }
    const inserted = await client.query(`
      INSERT INTO tracking_updates (shipment_id,current_location,status,update_time)
      VALUES ($1,$2,$3,CURRENT_TIMESTAMP) RETURNING *
    `, [Number(req.params.id), String(current_location).trim(), String(status).trim()]);
    await client.query("UPDATE shipments SET shipment_status=$1 WHERE shipment_id=$2", [String(status).trim(), Number(req.params.id)]);
    await client.query("COMMIT");
    res.status(201).json(inserted.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: "Could not add tracking update.", detail: err.message });
  } finally {
    client.release();
  }
});

app.get("*", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));
const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`Product Tracking app running at http://localhost:${port}`));