import { User } from "../models/User.js";

// Queued by app/observers/UserObserver when someone signs up, and run by
// "tylix queue:work", outside the request. Throwing marks the job failed,
// with the error recorded on its row in the jobs table.
export const SendWelcomeEmail = {
    async handle(payload: { userId: number | string }) {
        const user = await User.find(payload.userId);
        if (!user) return; // deleted since sign-up: nothing to send

        // Send a real email with a mailable, as app/mail/mailer does for
        // verification. Logged here so the job is visible in the worker.
        console.log(`Welcome email for ${String(user.email)} (user ${String(user.id)})`);
    },
};
