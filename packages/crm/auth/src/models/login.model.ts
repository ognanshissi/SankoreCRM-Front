export class LoginModel {
  public email!: string;
  public password!: string;

  private constructor() {}

  public static instantiate(): LoginModel {
    const model = new LoginModel();
    model.email = '';
    model.password = '';
    return model;
  }
}
