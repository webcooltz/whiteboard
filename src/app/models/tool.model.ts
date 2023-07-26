export class Tool {
  public name: string;
  public description: string;
  public icon: string;
  public type: string;

  constructor(name: string, description: string, icon: string, type: string) {
    this.name = name;
    this.description = description;
    this.icon = icon;
    this.type = type;
  }
}
