const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
app.use(cors());
app.use(express.json());

// Test endpoint
app.get("/", (req, res) => {
    res.send("API is working");
});

// Kullanıcının coin miktarını getir
app.get("/coins/:telegram_id", async (req, res) => {
    const { telegram_id } = req.params;
    try {
        const [rows] = await db.query(
            "SELECT coin_balance FROM users WHERE telegram_id = ?", 
            [telegram_id]
        );
        if (rows.length > 0) {
            res.json({ coins: rows[0].coin_balance });
        } else {
            res.status(404).json({ error: "User not found" });
        }
    } catch (error) {
        console.error("Hata:", error);
        res.status(500).json({ error: "Server error" });
    }
});

// Coin ekleme (tıklama işlemi)
app.post("/coins/increment", async (req, res) => {
    const { telegram_id } = req.body;

    try {
        const [rows] = await db.query(
            "SELECT coin_balance FROM users WHERE telegram_id = ?", 
            [telegram_id]
        );
        if (rows.length > 0) {
            const newCoins = parseFloat(rows[0].coin_balance) + 1;
            await db.query(
                "UPDATE users SET coin_balance = ? WHERE telegram_id = ?", 
                [newCoins, telegram_id]
            );
            res.json({ success: true, newCoins });
        } else {
            res.status(404).json({ error: "User not found" });
        }
    } catch (error) {
        console.error("Coin update error:", error);
        res.status(500).json({ error: "Server error" });
    }
});

app.listen(3000, () => {
    console.log("Backend API working: http://localhost:3000");
});
