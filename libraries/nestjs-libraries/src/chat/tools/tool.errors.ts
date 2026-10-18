import { HttpException } from '@nestjs/common';

// The service refuses with the HTTP status the app shows; a tool answers the
// same refusal as output.errors, so the client can fix the call and retry
export const asToolErrors = (err: unknown) => {
  if (err instanceof HttpException) {
    return { output: { errors: err.message } };
  }
  throw err;
};
