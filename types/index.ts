export type Todo = {
  content: string;
  order: number;
  completed: boolean;
};

export type TodoWithID = Todo & { id: string };
