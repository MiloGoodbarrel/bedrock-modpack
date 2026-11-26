// A minimal fake of @minecraft/server-ui (tests never show forms; this just lets modules load).
class Form {
  title() {
    return this;
  }
  body() {
    return this;
  }
  button() {
    return this;
  }
  button1() {
    return this;
  }
  button2() {
    return this;
  }
  toggle() {
    return this;
  }
  dropdown() {
    return this;
  }
  textField() {
    return this;
  }
  submitButton() {
    return this;
  }
  async show() {
    return { canceled: true };
  }
}
export class ActionFormData extends Form {}
export class MessageFormData extends Form {}
export class ModalFormData extends Form {}
export const FormCancelationReason = { UserBusy: "UserBusy", UserClosed: "UserClosed" };
