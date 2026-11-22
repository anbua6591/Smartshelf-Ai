# SmartShelf AI – Intelligent Inventory Optimization System

A browser-based inventory manager for small retail shops. It tracks stock, forecasts demand from real sales history, and tells you what to reorder, how much, and why. No server, no API key, no build step.

## Run it
Open `index.html` in a browser. Charts and icons load from a CDN, so you need an internet connection the first time.

## Features
- **Dashboard**: product count, stock units, low/out-of-stock, inventory value, 7-day revenue, sales chart, top alerts
- **Inventory**: add, edit, delete, search, filter, record a sale (updates stock and history)
- **Demand Forecast**: 7-day prediction per product, fast/medium/slow classification, plain-language explanation
- **Smart Restock**: reorder point, order quantity and the full calculation shown per product
- **Alerts**: out of stock, low stock, expired, expiring within 30 days, dead stock (no sales in 14 days), overstock
- **Analytics**: daily, weekly, monthly sales, inventory value by category, actual vs predicted demand
- **CSV**: import and export (`sample-inventory.csv` is ready to import)

## How the forecast works
Each product stores 90 days of daily sales.
1. Level = average of the last 7 days.
2. Trend = least-squares slope over the last 28 days.
3. Forecast for day k = max(0, level + trend × (k + 3)). The 7-day average is centred about 3 days back.

Speed class: products ranked by 28-day average sales; top third = Fast, bottom third (or zero sales) = Slow.

## How reorder quantities work
- Safety stock = 1.65 × std-dev of daily sales × √lead time (about 95% service level)
- Reorder point = forecast/day × lead time + safety stock
- Target stock = forecast/day × (lead time + cover days) + safety stock
- Order quantity = target − stock on hand

Lead time (default 3 days) and cover (default 14 days) can be changed on the Smart Restock page.

## About the sample data
The 17 sample products have 90 days of generated sales (weekday/weekend pattern, trend, noise) so the demo works on first launch. Your own data replaces it. New products start with a flat history from the daily average you enter; record real sales to sharpen forecasts.

## CSV format
`id,name,category,stock,min_stock,price,expiry,daily_sales` (optional `history`: 90 values separated by `|`). Only `name` is required. Expiry format is `YYYY-MM-DD`. Existing IDs are updated.

## Deploy with GitHub Pages
1. Create a new public repository on github.com (for example `smartshelf-ai`).
2. In a terminal inside this folder:
   ```
   git init
   git add .
   git commit -m "SmartShelf AI"
   git branch -M main
   git remote add origin https://github.com/YOUR-USERNAME/smartshelf-ai.git
   git push -u origin main
   ```
3. On GitHub: Settings → Pages → Source: "Deploy from a branch" → Branch: `main`, folder `/ (root)` → Save.
4. After about a minute the site is live at `https://YOUR-USERNAME.github.io/smartshelf-ai/`.

If you uploaded the folder instead of the files, move the files to the repository root so `index.html` is at the top level.

## Demo script (3 minutes)
1. Dashboard: point out low/out-of-stock cards and alerts.
2. Demand Forecast: pick Whole Milk and read the explanation.
3. Smart Restock: show the calculation column.
4. Inventory: record a sale, add a product, import `sample-inventory.csv`.
5. Alerts and Analytics: expiry, dead stock (Shampoo), charts updating.
