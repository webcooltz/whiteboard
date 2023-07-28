export class SprayOptions {
  public radius: number; // 1 - 15
  public density: number; // 1 - 100

  constructor(radius: number, density: number) {
    this.radius = radius;
    this.density = density;
  }
}
