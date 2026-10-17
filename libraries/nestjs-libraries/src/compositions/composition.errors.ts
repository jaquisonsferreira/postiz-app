export class CompositionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompositionValidationError';
  }
}
