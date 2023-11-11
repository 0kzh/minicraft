uniform vec2 u_resolution;
uniform float u_time;

void main() {
		vec2 st = gl_FragCoord.xy/u_resolution.xy;
		gl_FragColor=vec4(st.x,st.y,0.0,1.0);
}