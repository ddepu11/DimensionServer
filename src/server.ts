import express, { Request, Response } from "express";
import { handlePull } from "./pull";
import { handlePush } from "./push";

const port = process.env.PORT || 9000;

const app = express();

// Body parser middlewere
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

app.post("/api/replicache/pull", handlePull);
app.post("/api/replicache/push", handlePush);

app.get("/api/status", (_: Request, res: Response) => {
  res.status(200).json({ message: "Server is running fine! Sab Changa si :)" });
});

app.listen(port, () => console.log(`Server is up and running in port ${port}`));
