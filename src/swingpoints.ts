import { HighLow, SwingPoint } from "./interfaces";

export class SwingPoints {
    private highSwing:SwingPoint = {tradeId: 0, price: 0, timeStamp: 0};
    private lowSwing:SwingPoint = {tradeId: 0, price: 0, timeStamp: 0};
    private lastSwingPoint:HighLow = HighLow.HIGH;
    private readonly bandWidth:number;
    private swingHighs: SwingPoint[] = [];
    private swingLows: SwingPoint[] = [];

    constructor(bandWidth: number = 0.01) {
        if ( bandWidth <= 0 || bandWidth >= 1) {
            throw new Error("bandWidth must be between 0 and 1");
        }
        this.bandWidth = bandWidth; // it is a percentage 0.01 = 1%
    }

    public addPriceLevel(price: number, tradeId:number, timeStamp:number ): void {
        // first check if we have a new higher limit
        if (price > this.highSwing.price) {
            this.highSwing = {tradeId, price, timeStamp};
            this.lastSwingPoint = HighLow.HIGH;
        }

        // if not then maybe we have a new lower limit
        else if (price < this.lowSwing.price) {
            this.lowSwing = {tradeId, price, timeStamp};
            this.lastSwingPoint = HighLow.LOW;
        }

        // maybe we have a new bandwith limit 
        else {
            if (this.lastSwingPoint === HighLow.HIGH && price <= this.highSwing.price * (1 - this.bandWidth)) {
                // we have a new lower limit, confirming the current high point as a swing point
                this.lowSwing = {tradeId, price, timeStamp};
                this.lastSwingPoint = HighLow.LOW;
                this.swingHighs.push(this.highSwing);
                console.log("New low limit detected (BandWidth): Swing High order confirmed: %s of %s at %s", this.highSwing.tradeId, this.highSwing.price, new Date(this.highSwing.timeStamp));
                
            } else if (this.lastSwingPoint === HighLow.LOW && price >= this.lowSwing.price * (1 + this.bandWidth)) {
                // we have a new higher limit, confirming the current low point as a swing point
                this.highSwing = {tradeId, price, timeStamp};
                this.lastSwingPoint = HighLow.HIGH;
                this.swingLows.push(this.lowSwing);
                console.log("New high limit detected (BandWidth): Swing Low order confirmed: %s of %s at %s", this.lowSwing.tradeId, this.lowSwing.price, new Date(this.lowSwing.timeStamp));
            }

        }
    }

    public getSwingPoints(): {highs: SwingPoint[], lows: SwingPoint[]} {
        return {highs: this.swingHighs, lows: this.swingLows};
    }
}