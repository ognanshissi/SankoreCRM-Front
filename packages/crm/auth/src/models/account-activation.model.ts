export class AccountActivationModel {
  public password!: string;
  public confirmPassword!: string;

  public static instantiate(): AccountActivationModel {
    const model = new AccountActivationModel();
    model.password = '';
    model.confirmPassword = '';
    return model;
  }
}
