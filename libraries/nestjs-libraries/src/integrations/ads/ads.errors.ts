export class AdsApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdsApiError';
  }
}

// The platform no longer accepts the saved login: only the user connecting the
// account again brings it back, so the sync skips it instead of retrying
export class AdsReconnectRequiredError extends Error {
  constructor(message = 'The ad account must be connected again') {
    super(message);
    this.name = 'AdsReconnectRequiredError';
  }
}
