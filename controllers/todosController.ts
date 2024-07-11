import { serverID, tx, type Transaction } from "../src/db";
import type {
  MutationV1,
  PatchOperation,
  PullResponse,
  PushRequestV1,
} from "replicache";
import type { Request, Response, NextFunction } from "express";
import type { TodoWithID } from "../types";

// Pull todos
export async function pullTodos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const resp = await pull(req, res);
    res.json(resp);
  } catch (e) {
    next(e);
  }
}

async function pull(req: Request, res: Response) {
  const pull = req.body;
  // console.log(`Processing pull`, JSON.stringify(pull));
  const { clientGroupID } = pull;
  const fromVersion = pull.cookie ?? 0;
  const t0 = Date.now();
  try {
    // Read all data in a single transaction so it's consistent.
    await tx(async (t) => {
      // Get current version.
      const { version: currentVersion } = await t.one<{ version: number }>(
        "select version from replicache_server where id = $1",
        serverID
      );

      if (fromVersion > currentVersion) {
        throw new Error(
          `fromVersion ${fromVersion} is from the future - aborting. This can happen in development if the server restarts. In that case, clear appliation data in browser and refresh.`
        );
      }

      // Get lmids for requesting client groups.
      const lastMutationIDChanges = await getLastMutationIDChanges(
        t,
        clientGroupID,
        fromVersion
      );

      // Get changed domain objects since requested version.
      const changed = await t.manyOrNone<{
        id: string;
        content: string;
        ord: number;
        version: number;
        completed: boolean;
      }>(
        "select id, content, ord, version, completed from todo where version > $1",
        fromVersion
      );

      // Build and return response.
      const patch: PatchOperation[] = [];
      for (const row of changed) {
        const { id, content, ord, version: rowVersion, completed } = row;

        patch.push({
          op: "put",
          key: `todo/${id}`,
          value: {
            content,
            order: ord,
            completed,
          },
        });
      }

      const body: PullResponse = {
        lastMutationIDChanges: lastMutationIDChanges ?? {},
        cookie: currentVersion,
        patch,
      };
      res.json(body);
      res.end();
    });
  } catch (e) {
    console.error(e);
    res.status(500).send(e);
  } finally {
    console.log("Processed pull in", Date.now() - t0);
  }
}

async function getLastMutationIDChanges(
  t: Transaction,
  clientGroupID: string,
  fromVersion: number
) {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const rows = await t.manyOrNone<{ id: string; last_mutation_id: number }>(
    `select id, last_mutation_id
    from replicache_client
    where client_group_id = $1 and version > $2`,
    [clientGroupID, fromVersion]
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.last_mutation_id]));
}

// ############################################

// Push todos
export async function pushTodos(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await push(req, res);
  } catch (e) {
    next(e);
  }
}

async function push(req: Request, res: Response) {
  const push: PushRequestV1 = req.body;
  console.log("Processing push", JSON.stringify(push));

  const t0 = Date.now();
  try {
    // Iterate each mutation in the push.
    for (const mutation of push.mutations) {
      console.log("_________mutation", mutation);
      const t1 = Date.now();

      try {
        await tx((t) => processMutation(t, push.clientGroupID, mutation));
      } catch (e) {
        console.error("Caught error from mutation", mutation, e);

        // Handle errors inside mutations by skipping and moving on. This is
        // convenient in development but you may want to reconsider as your app
        // gets close to production:
        // https://doc.replicache.dev/reference/server-push#error-handling
        await tx((t) =>
          processMutation(t, push.clientGroupID, mutation, e as string)
        );
      }

      console.log("Processed mutation in", Date.now() - t1);
    }

    res.send("{}");

    await sendPoke();
  } catch (e) {
    console.error(e);
    res.status(500).send(e);
  } finally {
    console.log("Processed push in", Date.now() - t0);
  }
}

async function processMutation(
  t: Transaction,
  clientGroupID: string,
  mutation: MutationV1,
  error?: string | undefined
) {
  const { clientID } = mutation;

  // Get the previous version and calculate the next one.
  const { version: prevVersion } = await t.one(
    "select version from replicache_server where id = $1 for update",
    serverID
  );
  const nextVersion = prevVersion + 1;

  const lastMutationID = await getLastMutationID(t, clientID);
  const nextMutationID = lastMutationID + 1;

  console.log("nextVersion", nextVersion, "nextMutationID", nextMutationID);

  // It's common due to connectivity issues for clients to send a
  // mutation which has already been processed. Skip these.
  if (mutation.id < nextMutationID) {
    console.log(
      `Mutation ${mutation.id} has already been processed - skipping`
    );
    return;
  }

  // If the Replicache client is working correctly, this can never
  // happen. If it does there is nothing to do but return an error to
  // client and report a bug to Replicache.
  if (mutation.id > nextMutationID) {
    throw new Error(
      `Mutation ${mutation.id} is from the future - aborting. This can happen in development if the server restarts. In that case, clear appliation data in browser and refresh.`
    );
  }

  if (error === undefined) {
    console.log("Processing mutation:", JSON.stringify(mutation));

    // For each possible mutation, run the server-side logic to apply the
    // mutation.
    switch (mutation.name) {
      case "createTodo":
        await createTodo(t, mutation.args as TodoWithID, nextVersion);
        break;
      default:
        throw new Error(`Unknown mutation: ${mutation.name}`);
    }
  } else {
    // TODO: You can store state here in the database to return to clients to
    // provide additional info about errors.
    console.log(
      "Handling error from mutation",
      JSON.stringify(mutation),
      error
    );
  }

  console.log("setting", clientID, "last_mutation_id to", nextMutationID);
  // Update lastMutationID for requesting client.
  await setLastMutationID(
    t,
    clientID,
    clientGroupID,
    nextMutationID,
    nextVersion
  );

  // Update global version.
  await t.none("update replicache_server set version = $1 where id = $2", [
    nextVersion,
    serverID,
  ]);
}

export async function getLastMutationID(t: Transaction, clientID: string) {
  const clientRow = await t.oneOrNone(
    "select last_mutation_id from replicache_client where id = $1",
    clientID
  );
  if (!clientRow) {
    return 0;
  }
  return parseInt(clientRow.last_mutation_id);
}

async function setLastMutationID(
  t: Transaction,
  clientID: string,
  clientGroupID: string,
  mutationID: number,
  version: number
) {
  const result = await t.result(
    `update replicache_client set
        client_group_id = $2,
        last_mutation_id = $3,
        version = $4
      where id = $1`,
    [clientID, clientGroupID, mutationID, version]
  );
  if (result.rowCount === 0) {
    await t.none(
      `insert into replicache_client (
          id,
          client_group_id,
          last_mutation_id,
          version
        ) values ($1, $2, $3, $4)`,
      [clientID, clientGroupID, mutationID, version]
    );
  }
}

async function createTodo(
  t: Transaction,
  { id, content, order }: TodoWithID,
  version: number
) {
  await t.none(
    `insert into todo (
      id, content, ord, completed, version) values
      ($1, $2, $3, false, $4)`,
    [id, content, order, version]
  );
}

async function sendPoke() {
  // TODO
}
