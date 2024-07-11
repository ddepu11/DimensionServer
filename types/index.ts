export type Todo = {
  content: string;
  order: number;
};

export type TodoWithID = Todo & { id: string };
