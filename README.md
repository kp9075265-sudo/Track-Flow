# TrackFlow Product Tracking Management System

## Uses your existing PostgreSQL table names
The backend expects these tables and columns as shown in the screenshots:
- customers(customer_id, first_name, last_name, email, phone, registration_date)
- addresses(address_id, customer_id, street, city, state, pincode, country)
- categories(category_id, category_name, description)
- products(product_id, category_id, product_name, description, price, stock_quantity)
- orders(order_id, customer_id, order_date, order_status, total_amount)
- order_items(order_item_id, order_id, product_id, quantity, price)
- payments(payment_id, order_id, payment_method, payment_status, payment_date)
- shipments(shipment_id, order_id, warehouse_id, agent_id, shipment_status)
- tracking_updates(tracking_id, shipment_id, current_location, status, update_time)
- warehouses(warehouse_id, warehouse_name, city, state)
- delivery_agents(agent_id, name, phone, vehicle_type, availability)
- notifications(notification_id, customer_id, message, sent_at)

## Setup
1. Extract the ZIP and open the folder in VS Code.
2. In the folder terminal run `npm install`.
3. Copy `.env.example` to `.env`; fill in your PostgreSQL database name, username, and password.
4. Ensure the database contains the tables above. This project does not automatically create or overwrite your existing tables.
5. Run `npm start`.
6. Visit http://localhost:3000.

## Features
- Dashboard KPIs and recent orders
- Product search, create, edit, and delete
- Category dropdown populated from PostgreSQL
- Shipment list, tracking timeline, and tracking update form
- API health check at `/api/health`

## Important
The backend uses your plural table name `categories` and `order_items` is not directly needed by the current dashboard APIs. If your database has different column names, adjust the SQL in `server.js`.
