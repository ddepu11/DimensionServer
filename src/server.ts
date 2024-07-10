import express, { Request, Response } from "express";

const port = process.env.PORT || 8000;

const app = express();

// Body parser middlewere
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get("/api/status", (req: Request, res: Response) => {
  res.json({ message: "Server is running fine!" });
});

app.listen(port, () => console.log(`Server is up and running in port ${port}`));
