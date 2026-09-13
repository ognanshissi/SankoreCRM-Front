export class ResetPasswordModel {
  public password!: string;
  public confirmPassword!: string;

  private constructor() {}

  public static instantiate(): ResetPasswordModel {
    const model = new ResetPasswordModel();
    model.password = '';
    model.confirmPassword = '';
    return model;
  }
}
