import Pusher from "pusher";

const {
  REPLICHAT_PUSHER_APP_ID,
  REPLICHAT_PUSHER_KEY,
  REPLICHAT_PUSHER_SECRET,
  REPLICHAT_PUSHER_CLUSTER,
} = process.env;

export const sendPoke = async () => {
  if (
    !REPLICHAT_PUSHER_APP_ID ||
    !REPLICHAT_PUSHER_KEY ||
    !REPLICHAT_PUSHER_SECRET ||
    !REPLICHAT_PUSHER_CLUSTER
  ) {
    throw new Error("Missing Pusher environment variables");
  }

  const pusher = new Pusher({
    appId: REPLICHAT_PUSHER_APP_ID,
    key: REPLICHAT_PUSHER_KEY,
    secret: REPLICHAT_PUSHER_SECRET,
    cluster: REPLICHAT_PUSHER_CLUSTER,
    useTLS: true,
  });

  try {
    await pusher.trigger("default", "poke", {
      message: "hello world",
    });
  } catch (err) {}
};
