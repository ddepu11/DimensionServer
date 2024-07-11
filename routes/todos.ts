import express from "express";
import { pullTodos, pushTodos } from "../controllers/todosController";

const routes = express.Router();

routes.post("/pull", pullTodos);

routes.post("/push", pushTodos);

export default routes;
