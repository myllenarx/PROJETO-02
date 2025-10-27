public class BinarioOperacoes {

    public static int binToDec(String bin, String metodo) {
        int n = bin.length();
        if (metodo.equals("sm")) { 
            int sinal = (bin.charAt(0) == '1') ? -1 : 1;
            return sinal * Integer.parseInt(bin.substring(1), 2);

        } else if (metodo.equals("c1")) { 
            if (bin.charAt(0) == '0') {
                return Integer.parseInt(bin, 2);
            } else {
                StringBuilder invertido = new StringBuilder();
                for (char c : bin.toCharArray()) {
                    invertido.append(c == '0' ? '1' : '0');
                }
                return -Integer.parseInt(invertido.toString(), 2);
            }

        } else if (metodo.equals("c2")) { 
            if (bin.charAt(0) == '0') {
                return Integer.parseInt(bin, 2);
            } else {
                return Integer.parseInt(bin, 2) - (1 << n);
            }

        } else if (metodo.equals("polarizada")) { 
            int polarizada = (1 << (n - 1)) - 1;
            return Integer.parseInt(bin, 2) - polarizada;
        }
        return 0;
    }

    public static String decToBin(int num, int bits, String metodo) {
        if (metodo.equals("sm")) { 
            String sinal = (num < 0) ? "1" : "0";
            return sinal + String.format("%" + (bits - 1) + "s", 
                   Integer.toBinaryString(Math.abs(num))).replace(' ', '0');

        } else if (metodo.equals("c1")) { 
            if (num >= 0) {
                return String.format("%" + bits + "s", 
                       Integer.toBinaryString(num)).replace(' ', '0');
            } else {
                String pos = String.format("%" + bits + "s", 
                              Integer.toBinaryString(Math.abs(num))).replace(' ', '0');
                StringBuilder inv = new StringBuilder();
                for (char c : pos.toCharArray()) {
                    inv.append(c == '0' ? '1' : '0');
                }
                return inv.toString();
            }

        } else if (metodo.equals("c2")) { 
            if (num >= 0) {
                return String.format("%" + bits + "s", 
                       Integer.toBinaryString(num)).replace(' ', '0');
            } else {
                int valor = (1 << bits) + num;
                return String.format("%" + bits + "s", 
                       Integer.toBinaryString(valor)).replace(' ', '0');
            }

        } else if (metodo.equals("polarizada")) { 
            int polarizada = (1 << (bits - 1)) - 1;
            return String.format("%" + bits + "s", 
                   Integer.toBinaryString(num + polarizada)).replace(' ', '0');
        }
        return "";
    }

    public static String[] operar(String a, String b, String op, String metodo, int bits) {
        int decA = binToDec(a, metodo);
        int decB = binToDec(b, metodo);
        int res = 0;

        switch (op) {
            case "+": res = decA + decB; break;
            case "-": res = decA - decB; break;
            case "*": res = decA * decB; break;
            case "/": res = decA / decB; break;
        }

        String resBin = decToBin(res, bits, metodo);
        return new String[] {resBin, String.valueOf(res)};
    }

    // Teste
    public static void main(String[] args) {
        int bits = 8;
        String metodo = "c2"; 
        String a = decToBin(5, bits, metodo);
        String b = decToBin(-3, bits, metodo);

        System.out.println("5 = " + a + " | -3 = " + b);

        String[] resultado = operar(a, b, "+", metodo, bits);
        System.out.println("Soma: " + resultado[0] + " = " + resultado[1]);
    }
}