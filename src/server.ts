import "dotenv/config";
import express, { Request, Response } from "express";
import todos from "../routes/todos";

const port = process.env.PORT || 9000;

const app = express();

// Body parser middlewere
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.use("/api/replicache/", todos);

app.get("/api/status", (_: Request, res: Response) => {
  res.status(200).json({ message: "Server is running fine! Sab Changa si :)" });
});

app.listen(port, () => console.log(`Server is up and running in port ${port}`));
