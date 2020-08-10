class XorShift128 {
    x: number;
    y: number;
    z: number;
    w: number;

    constructor(x: number, y: number, z: number, w: number) {
        this.x = (x ? x >>> 0 : 123456789);
        this.y = (y ? y >>> 0 : 362436069);
        this.z = (z ? z >>> 0 : 521288629);
        this.w = (w ? w >>> 0 : 88675123);
    }

    next() {
        // eslint-disable-next-line no-mixed-operators
        const t = this.x ^ (this.x << 11) & 0x7FFFFFFF;
        this.x = this.y;
        this.y = this.z;
        this.z = this.w;
        this.w = (this.w ^ (this.w >> 19)) ^ (t ^ (t >> 8));
        return this.w;
    }

    unit() {
        return this.next() / 0x80000000;
    }

    unitInclusive() {
        return this.next() / 0x7FFFFFFF;
    }

    integer(min: number, max: number) {
        return this.integerExclusive(min, max + 1);
    }

    integerExclusive(min: number, max: number) {
        min = Math.floor(min);
        max = Math.floor(max);
        return Math.floor(this.unit() * (max - min)) + min;
    }

    real(min: number, max: number) {
        return this.unit() * (max - min) + min;
    }

    realInclusive(min: number, max: number) {
        return this.unitInclusive() * (max - min) + min;
    }

    reseed(x: number, y: number, z: number, w: number) {
        this.x = (x ? x >>> 0 : 123456789);
        this.y = (y ? y >>> 0 : 362436069);
        this.z = (z ? z >>> 0 : 521288629);
        this.w = (w ? w >>> 0 : 88675123);
    }
}

export default XorShift128;